# Orbit desktop

The desktop shell reuses the Web renderer and Pi backend. Electron 44.7.0 supplies Node 24.21.0; the backend runs in an isolated utility process with native `node:sqlite`. TypeScript is compiled before launch, retaining the server/apps/skills resource layout.

## Run and package

```sh
npm ci
npm run desktop:dev
npm run desktop:pack
```

`desktop:dev` first runs the bundled `install-electron` command to ensure the Electron binary exists, builds the Web UI and desktop runtime, then opens Orbit. The first run needs network access; later runs reuse the downloaded binary. The developer's existing `.env.local` is loaded by the launcher and never copied into the package. After source changes, restart this command.

`desktop:pack` produces `desktop-dist/Orbit-darwin-arm64/Orbit.app` and `desktop-dist/Orbit-macOS-arm64.zip` on Apple Silicon (or the corresponding `x64` names on an Intel Mac). The local demo uses an ad hoc signature, verified inside-out before archiving, and is not notarized. It does not promise to retain macOS permissions across rebuilds. Distribution to other Macs requires Developer ID signing/notarization; this task does not provide an Apple signing identity or automatic updates. See [the signing notes](../scripts/desktop-signing.md) for the local signing checks.

The staging allowlist includes compiled backend/app definitions, renderer `dist`, `desktop`, `skills`, the native helper source and production npm dependencies. It excludes `.env*`, `.agent-data`, local MCP configuration, `work`, source archives and user data. The application does not require a separate system Node installation.

The runtime package omits frontend-only React/Markdown/icon dependencies already compiled into `dist`, non-macOS esbuild binaries bundled by Pi, source maps and TypeScript declarations. Pi JavaScript, documentation, theme assets, WASM and the target platform binaries remain. The app icon is built from the cloud avatar in `public/images/orbit-cloud.png`.

## Interaction and lifecycle

- Option+Space toggles the quick assistant. If another app owns it, **File → 唤起助手** and Command+Shift+Space remain available.
- The Dock and **Window → 打开 Orbit** restore the main window.
- Closing a window preserves it in the background. **Orbit → 退出 Orbit** or Command+Q shuts down the Agent and both windows.
- Escape hides only the quick window, retaining its renderer and draft.
- The renderer's `window.orbitDesktop` bridge supports `hideQuick`, `resizeQuick`, `openMain`, `getInfo`, `onNavigate`, `readDrafts`, `writeDraft` and `requestMicrophonePermission`. It never exposes arbitrary filesystem, shell, IPC or credentials.
- `openMain({conversationId})` requests navigation only. The frontend owns message submission; the shell does not duplicate requests.
- Notification collection defaults to the macOS notification database reader and requires Full Disk Access after an explicit user action. The legacy accessibility reader is retained as an alternative implementation. Neither reader is started by the demo workspace.
- The permission bridge opens fixed macOS privacy panes and can reveal the currently running packaged app in Finder. It never grants permissions or changes the system permission database.

## Local state and backend contract

Normal macOS data lives in `~/Library/Application Support/Orbit/`:

- `data/`: SQLite, session state and outputs.
- `model-config.json`: model settings managed through the local API; never returned with the key.
- `voice-config.json`: Doubao realtime speech key, voice and capability verification, written atomically with mode 0600. `ORBIT_VOICE_CONFIG_PATH` can override its location; by default it lives next to the model configuration. Never packaged or returned with the key.
- `mcp.local.json`: optional user-installed MCP configuration.
- `desktop.log`: startup/lifecycle messages, without backend output or environment values.
- `drafts.json`: atomic, mode-0600 draft storage independent of the random backend port. Keeps at most 100 drafts and 2 MiB total; when full, removes the oldest modified drafts before the newest write. Text is limited to 40,000 characters and reference quotes to 4,000 characters.

The shell passes `ORBIT_DESKTOP=1`, `ORBIT_PORT=0`, `ORBIT_DATA_DIR`, `ORBIT_CONFIG_PATH` and `ORBIT_MCP_CONFIG`. The backend binds only to loopback, chooses a free port and reports it via utility-process IPC. Each launch receives a random `ORBIT_AUTH_TOKEN`, injected into exact-origin API requests by Electron and kept out of the renderer. Production UI, API and SSE use the same origin.

For isolated tests, `ORBIT_DESKTOP_USER_DATA` changes Electron's user-data root. This must be an absolute path under a disposable test directory. Desktop tests should not reuse a user's live data directory.

The main and quick renderers enable sandboxing and context isolation and disable Node integration. Permissions are denied except microphone capture by those two trusted main frames after the user presses the microphone control. The explicit bridge checks macOS microphone consent before allowing audio-only `getUserMedia`; cameras, embedded frames and other permissions stay blocked. Reloading a renderer requires a new explicit microphone request. The package supplies `NSMicrophoneUsageDescription`; server-side speech recognition does not use Apple's Speech Recognition permission. No recording or system permission request starts automatically.

New windows are blocked; external HTTP(S) links open in the system browser. API-token injection and IPC sender checks use exact origins. The packaged UI receives a restrictive CSP, with same-origin/blob media playback allowed for speech output.
