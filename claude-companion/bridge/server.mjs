#!/usr/bin/env node
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, ".config", "claude-companion");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

const defaultConfig = {
  host: "127.0.0.1",
  port: 8765,
  distro: "ubuntu",
  workspace: "/mnt/sdcard/ClaudeWorkspace",
  token: crypto.randomBytes(32).toString("hex")
};
let config;
try {
  config = Object.assign(defaultConfig, JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
} catch {
  config = defaultConfig;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  console.log("[claude-companion] Created config: " + CONFIG_FILE);
  console.log("[claude-companion] Pairing token (paste into the APK once): " + config.token);
}
if (config.host !== "127.0.0.1") {
  console.error("[claude-companion] Refusing to bind outside localhost.");
  process.exit(1);
}

const activeRuns = new Map();
const MAX_BODY = 1024 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function authorized(req) {
  const header = req.headers.authorization || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(String(config.token || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function childArgs(extraArgs, command) {
  return [
    "login", String(config.distro || "ubuntu"), "--",
    "env", "CC_WORKSPACE=" + String(config.workspace || "/mnt/sdcard/ClaudeWorkspace"),
    "bash", "-lc", command, "_", ...extraArgs
  ];
}
const shellInit = 'if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1 || true; fi;';

function runStatus() {
  return new Promise(resolve => {
    const script = shellInit + ' cd "$CC_WORKSPACE" 2>/dev/null || exit 41; command -v claude >/dev/null 2>&1 || exit 42; printf "__CC_VERSION__"; claude --version 2>/dev/null | head -n 1; printf "__CC_MODEL__%s\\n" "${ANTHROPIC_MODEL:-}"; printf "__CC_BASE__%s\\n" "${ANTHROPIC_BASE_URL:-}"; printf "__CC_CWD__%s\\n" "$PWD";';
    const child = spawn("proot-distro", childArgs([], script), { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    let finished = false;
    const done = (connected, code) => {
      if (finished) return;
      finished = true;
      const get = (marker) => {
        const line = output.split("\n").find(value => value.startsWith(marker));
        return line ? line.slice(marker.length).trim() : "";
      };
      const base = get("__CC_BASE__");
      let provider = "Anthropic";
      try { if (base) provider = new URL(base).host; } catch { if (base) provider = base; }
      resolve({
        connected,
        cliVersion: get("__CC_VERSION__"),
        model: get("__CC_MODEL__") || "CLI default model",
        provider: base ? provider : "Claude Code provider",
        workspace: get("__CC_CWD__") || config.workspace,
        workspaceName: path.basename(String(config.workspace).replace(/\/$/, "")) || "Workspace",
        message: connected ? "" : (code === 41 ? "Workspace path is not accessible inside Ubuntu PRoot." : code === 42 ? "Original Claude Code CLI was not found in Ubuntu PRoot." : "Cannot reach Claude Code in Ubuntu PRoot.")
      });
    };
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.on("error", () => done(false, -1));
    child.on("close", code => done(code === 0, code));
    setTimeout(() => { if (!finished) { child.kill("SIGKILL"); done(false, -2); } }, 12000).unref();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    return res.end();
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/health") return sendJson(res, 200, { ok: true, service: "claude-companion-bridge" });
  if (!url.pathname.startsWith("/v1/")) return sendJson(res, 404, { error: "Not found" });
  if (!authorized(req)) return sendJson(res, 401, { error: "Unauthorized" });

  if (req.method === "GET" && url.pathname === "/v1/status") {
    const status = await runStatus();
    return sendJson(res, status.connected ? 200 : 503, status);
  }

  if (req.method === "POST" && url.pathname === "/v1/chat") {
    let body;
    try { body = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
    const prompt = String(body.prompt || "").trim();
    const runId = String(body.runId || "");
    if (!prompt) return sendJson(res, 400, { error: "Prompt is required" });
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(runId)) return sendJson(res, 400, { error: "Invalid run ID" });
    if (activeRuns.has(runId)) return sendJson(res, 409, { error: "Run ID is already active" });

    const extra = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--include-partial-messages"];
    if (body.sessionId) {
      const sessionId = String(body.sessionId);
      if (!/^[a-zA-Z0-9_-]{6,120}$/.test(sessionId)) return sendJson(res, 400, { error: "Invalid Claude session ID" });
      extra.push("--resume", sessionId);
    }
    if (body.model) {
      const model = String(body.model);
      if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(model)) return sendJson(res, 400, { error: "Invalid model identifier" });
      extra.push("--model", model);
    }

    const script = shellInit + ' cd "$CC_WORKSPACE" || exit 41; exec claude "$@"';
    const child = spawn("proot-distro", childArgs(extra, script), { stdio: ["pipe", "pipe", "pipe"] });
    activeRuns.set(runId, child);
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "X-Accel-Buffering": "no"
    });
    let stderr = "";
    child.stdout.on("data", chunk => { if (!res.destroyed) res.write(chunk); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk.toString()).slice(-1600); });
    child.on("error", error => {
      if (!res.headersSent) sendJson(res, 500, { error: "Could not start proot-distro: " + error.message });
      else if (!res.destroyed) res.write(JSON.stringify({ type: "bridge_error", message: "Could not start the original Claude Code CLI." }) + "\n");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: prompt }] }
    }) + "\n");
    child.on("close", code => {
      activeRuns.delete(runId);
      if (!res.destroyed) {
        if (code !== 0 && stderr.trim()) {
          const safe = stderr.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(-800);
          res.write(JSON.stringify({ type: "bridge_error", message: safe }) + "\n");
        }
        res.write(JSON.stringify({ type: "bridge_exit", code }) + "\n");
        res.end();
      }
    });
    res.on("close", () => {
      if (!res.writableEnded && activeRuns.has(runId)) {
        child.kill("SIGTERM");
        activeRuns.delete(runId);
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/stop") {
    let body;
    try { body = await readJson(req); } catch (error) { return sendJson(res, 400, { error: error.message }); }
    const runId = String(body.runId || "");
    const child = activeRuns.get(runId);
    if (child) {
      child.kill("SIGTERM");
      activeRuns.delete(runId);
    }
    return sendJson(res, 200, { stopped: !!child });
  }
  return sendJson(res, 404, { error: "Not found" });
});

server.listen(Number(config.port || 8765), "127.0.0.1", () => {
  console.log("[claude-companion] Listening on http://127.0.0.1:" + Number(config.port || 8765));
  console.log("[claude-companion] Distro: " + config.distro + " | Workspace: " + config.workspace);
  console.log("[claude-companion] The Android APK connects in the background; this service never launches the Termux UI.");
});
