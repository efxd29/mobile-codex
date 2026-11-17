# Claude Code Companion for Android

A standalone Android APK with a Claude Code-inspired mobile interface. The app connects to a local bridge running in Termux. The bridge launches the **user-installed, unmodified official Claude Code CLI** inside the configured Ubuntu PRoot distribution. No Claude Code binary, source, or implementation is bundled, patched, forked, or rebuilt here.

> This is an independent third-party companion app, not an official Anthropic app. The Android UI is custom; the Claude Code CLI remains the original installed CLI.

## Architecture

`Android APK (independent launcher app) → HTTP localhost bridge → Termux Node.js service → proot-distro login ubuntu → original claude CLI`

The Android app never starts or opens the Termux activity. It only talks to `127.0.0.1:8765`. Termux must have the bridge service running in the background; Android app sandboxing does not let one app start arbitrary processes inside another app.

## Build APK

From the repository root:

```sh
./gradlew -p claude-companion :app:assembleDebug
```

Output:

`claude-companion/app/build/outputs/apk/debug/app-debug.apk`

GitHub Actions builds the APK when files in `claude-companion/` or its workflow change and uploads it as `claude-code-companion-debug-apk`.

## Termux bridge installation

Run this once from Termux (not Ubuntu PRoot):

```sh
curl -fsSL https://raw.githubusercontent.com/efxd29/mobile-codex/claude-code-companion/claude-companion/bridge/install.sh | bash
```

The installer downloads the bridge into `$HOME/.config/claude-companion/`, installs Node.js and termux-services, creates a local-only service, and prints a random pairing token. Paste that token into the Android app's connection settings. The service binds only to `127.0.0.1` and requires the bearer token for API calls.

The default Ubuntu PRoot and workspace are:

- Distro: `ubuntu`
- Workspace: `/mnt/sdcard/ClaudeWorkspace`

Change `$HOME/.config/claude-companion/config.json` in Termux to use a different distro or workspace, then restart the service with `sv restart claude-companion`. Put the workspace path as it is seen **inside Ubuntu PRoot**.

## Claude Code requirements

Install and authenticate Claude Code yourself inside the Ubuntu PRoot distro using Anthropic's official installation and login flow. The bridge only invokes the `claude` command already on the distro PATH; it does not download or modify the CLI.

The bridge starts print-mode streaming through the official CLI flags `--input-format stream-json` and `--output-format stream-json`, and reuses official CLI sessions with `--resume`. The CLI reads its existing shell environment and Claude configuration. No API keys are copied into the Android APK.

## Current implementation boundary

- Implemented: standalone Android shell, reference-style dark welcome screen, local bridge pairing, bridge status, streaming text messages, session resume ID handling, stop request, and Termux bridge service.
- Not implemented yet: interactive approval UI for every permission prompt, full file browser, project picker, complete recent-activity indexing, multi-provider/model editor, and live sync of every arbitrary shell variable. Provider/model display currently reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL` from the Ubuntu login shell; changing these in Termux/Ubuntu is reflected after the next status refresh when the login shell exports them.
- The default CLI permission mode is not overridden. The app does not pass `--dangerously-skip-permissions` or bypass the user's permission policy.

This is an initial functional foundation, not a claim that every Claude Code terminal feature is already mirrored in the app. Validate the bridge against the actual installed CLI version and a physical Android device before relying on it for source changes.
