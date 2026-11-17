(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let config = {};
  let activeRunId = null;
  let activeController = null;
  let sessionId = localStorage.getItem("claude.sessionId") || "";
  let messages = [];

  try { config = JSON.parse(NativeBridge.getConnectionConfig() || "{}"); } catch (_) { config = {}; }
  const baseUrl = () => (config.url || "http://127.0.0.1:8765").replace(/\/+$/, "");
  const authHeaders = () => config.token ? { Authorization: "Bearer " + config.token } : {};

  function setBridgeState(online, detail) {
    $("connectionDot").classList.toggle("online", !!online);
    $("bridgeState").classList.toggle("online", !!online);
    $("bridgeState").textContent = online ? "BRIDGE CONNECTED" : "BRIDGE OFFLINE";
    if (detail) $("recentLine").textContent = detail;
  }
  function openSettings() {
    $("bridgeUrl").value = config.url || "http://127.0.0.1:8765";
    $("bridgeToken").value = config.token || "";
    $("settingsBackdrop").classList.remove("hidden");
  }
  function closeSettings() { $("settingsBackdrop").classList.add("hidden"); }
  async function api(path, options = {}) {
    const headers = Object.assign({ "Content-Type": "application/json" }, authHeaders(), options.headers || {});
    return fetch(baseUrl() + path, Object.assign({}, options, { headers }));
  }
  async function refreshStatus() {
    if (!config.token) { setBridgeState(false, "Add your Termux bridge token to connect"); return; }
    try {
      const response = await api("/v1/status", { method: "GET", headers: {} });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const status = await response.json();
      setBridgeState(!!status.connected, status.connected ? "No recent activity" : (status.message || "Claude CLI unavailable"));
      if (status.cliVersion) $("cliVersion").textContent = status.cliVersion;
      if (status.workspace) {
        $("workspaceLine").textContent = status.workspace;
        $("windowPath").textContent = "— " + status.workspace;
      }
      if (status.model || status.provider) {
        $("accountLine").textContent = [status.model, status.provider].filter(Boolean).join(" · ");
      }
      $("workspaceName").textContent = status.workspaceName || "Ben";
      $("welcomeName").textContent = "Welcome back " + (status.userName || "Ben") + "!";
      if (status.recentActivity) $("recentLine").textContent = status.recentActivity;
      $("announcement").textContent = status.connected
        ? "↑ Original Claude Code CLI connected · changes in Termux are reflected here"
        : (status.message || "Claude Code CLI is not available in the configured Ubuntu PRoot.");
    } catch (error) {
      setBridgeState(false, "Bridge not reachable · " + error.message);
      $("announcement").textContent = "↑ Start the Termux bridge in the background. This APK will not open Termux.";
    }
  }
  function appendMessage(role, text, extraClass) {
    const node = document.createElement("div");
    node.className = "message " + role + (extraClass ? " " + extraClass : "");
    const label = document.createElement("span");
    label.className = "role";
    label.textContent = role === "user" ? "›" : role === "assistant" ? "●" : "!";
    const body = document.createElement("span");
    body.className = "body";
    body.textContent = text || "";
    node.appendChild(label);
    node.appendChild(body);
    $("messages").appendChild(node);
    $("messages").scrollTop = $("messages").scrollHeight;
    return { node, body };
  }
  function setBusy(busy) {
    $("sendButton").classList.toggle("visible", busy || $("promptInput").value.trim().length > 0);
    $("sendButton").textContent = busy ? "■" : "↑";
    $("sendButton").setAttribute("aria-label", busy ? "Stop Claude" : "Send prompt");
  }
  function randomId() { return "run-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9); }

  async function sendPrompt() {
    const input = $("promptInput");
    const prompt = input.value.trim();
    if (!prompt || activeRunId) return;
    if (!config.token) { openSettings(); return; }
    input.value = "";
    input.style.height = "auto";
    appendMessage("user", prompt);
    const assistant = appendMessage("assistant", "");
    activeRunId = randomId();
    activeController = new AbortController();
    setBusy(true);
    let assistantText = "";
    let buffer = "";
    try {
      const response = await api("/v1/chat", {
        method: "POST",
        signal: activeController.signal,
        body: JSON.stringify({ prompt, sessionId, runId: activeRunId })
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || ("HTTP " + response.status));
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const processLine = (line) => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch (_) { return; }
        if (event.type === "system" && event.subtype === "init") {
          if (event.session_id) { sessionId = event.session_id; localStorage.setItem("claude.sessionId", sessionId); }
          if (event.model) $("accountLine").textContent = event.model;
          if (event.cwd) $("workspaceLine").textContent = event.cwd;
        } else if (event.type === "assistant") {
          if (event.session_id) { sessionId = event.session_id; localStorage.setItem("claude.sessionId", sessionId); }
          const content = event.message && event.message.content;
          if (Array.isArray(content)) {
            const text = content.filter(part => part.type === "text").map(part => part.text || "").join("");
            const tools = content.filter(part => part.type === "tool_use").map(part => "Using " + part.name);
            if (text) assistantText = text;
            if (tools.length && !assistantText) assistantText = tools.join("\n");
            assistant.body.textContent = assistantText || tools.join(" · ");
          }
        } else if (event.type === "stream_event") {
          const delta = event.event && event.event.delta;
          if (delta && delta.type === "text_delta" && delta.text) {
            assistantText += delta.text;
            assistant.body.textContent = assistantText;
          }
        } else if (event.type === "result") {
          if (event.session_id) { sessionId = event.session_id; localStorage.setItem("claude.sessionId", sessionId); }
          if (!assistantText && event.result) assistant.body.textContent = event.result;
          if (event.is_error) assistant.node.classList.add("error");
        } else if (event.type === "bridge_error") {
          assistant.node.classList.add("error");
          assistant.body.textContent = event.message || "Bridge error";
        } else if (event.type === "bridge_exit" && event.code !== 0 && !assistant.body.textContent) {
          assistant.node.classList.add("error");
          assistant.body.textContent = "Claude Code exited with code " + event.code;
        }
      };
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        lines.forEach(processLine);
      }
      if (buffer.trim()) processLine(buffer);
      if (!assistant.body.textContent) assistant.body.textContent = "(No text output)";
    } catch (error) {
      if (error.name !== "AbortError") {
        assistant.node.classList.add("error");
        assistant.body.textContent = "Connection error: " + error.message;
      }
    } finally {
      activeRunId = null;
      activeController = null;
      setBusy(false);
      refreshStatus();
    }
  }

  async function stopClaude() {
    if (!activeRunId) return;
    const runId = activeRunId;
    try { await api("/v1/stop", { method: "POST", body: JSON.stringify({ runId }) }); } catch (_) {}
    if (activeController) activeController.abort();
    activeRunId = null;
    activeController = null;
    setBusy(false);
  }

  $("connectionButton").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", closeSettings);
  $("settingsBackdrop").addEventListener("click", (event) => { if (event.target === $("settingsBackdrop")) closeSettings(); });
  $("saveConnection").addEventListener("click", async () => {
    const url = $("bridgeUrl").value.trim();
    const token = $("bridgeToken").value.trim();
    if (!NativeBridge.saveConnection(url, token)) {
      $("settingsFeedback").textContent = "Use http://127.0.0.1:8765 (or localhost) and a token of at least 24 characters.";
      return;
    }
    config = { url: url.replace(/\/+$/, ""), token };
    $("settingsFeedback").textContent = "Saved securely in this app. Checking the bridge…";
    await refreshStatus();
    if ($("bridgeState").classList.contains("online")) closeSettings();
  });
  $("testConnection").addEventListener("click", async () => {
    config = { url: $("bridgeUrl").value.trim(), token: $("bridgeToken").value.trim() };
    try {
      const response = await api("/v1/status", { method: "GET", headers: {} });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const status = await response.json();
      $("settingsFeedback").textContent = status.connected
        ? "Connected to " + (status.cliVersion || "Claude Code") + " in " + (status.workspace || "workspace")
        : (status.message || "Bridge found, but Claude Code is unavailable.");
    } catch (error) {
      $("settingsFeedback").textContent = "Not connected: " + error.message;
    }
  });
  $("sendButton").addEventListener("click", () => activeRunId ? stopClaude() : sendPrompt());
  $("promptInput").addEventListener("input", () => {
    const node = $("promptInput");
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, 96) + "px";
    if (!activeRunId) $("sendButton").classList.toggle("visible", node.value.trim().length > 0);
  });
  $("promptInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendPrompt(); }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettings();
    if ((event.ctrlKey || event.metaKey) && event.key === ",") openSettings();
  });
  refreshStatus();
  setInterval(refreshStatus, 5000);
})();
