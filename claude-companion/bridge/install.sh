#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ROOT="$HOME/.config/claude-companion"
REPO_RAW="https://raw.githubusercontent.com/efxd29/mobile-codex/claude-code-companion/claude-companion/bridge"
mkdir -p "$ROOT"
pkg install -y nodejs-lts termux-services curl

curl -fsSL "$REPO_RAW/server.mjs" -o "$ROOT/server.mjs"
chmod 700 "$ROOT/server.mjs"

if [ ! -f "$ROOT/config.json" ]; then
  node -e 'const fs=require("fs"),c=require("crypto"),p=process.env.HOME+"/.config/claude-companion/config.json";fs.writeFileSync(p,JSON.stringify({host:"127.0.0.1",port:8765,distro:"ubuntu",workspace:"/mnt/sdcard/ClaudeWorkspace",token:c.randomBytes(32).toString("hex")},null,2)+"\n",{mode:0o600})'
fi

SERVICE="$PREFIX/var/service/claude-companion"
mkdir -p "$SERVICE"
cat > "$SERVICE/run" <<'RUN'
#!/data/data/com.termux/files/usr/bin/sh
exec "$PREFIX/bin/node" "$HOME/.config/claude-companion/server.mjs"
RUN
chmod 700 "$SERVICE/run"

echo
echo "Claude Code Companion bridge installed."
echo "The APK is a separate app and will NOT open the Termux screen."
echo "Pairing token (paste once in the app's connection settings):"
node -p 'require(process.env.HOME+"/.config/claude-companion/config.json").token'
echo
echo "Starting local bridge service..."
sv up claude-companion || true
echo
echo "Service status:"
sv status claude-companion || true
