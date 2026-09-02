# OpenUse macOS testing

This is the real macOS Computer Use path. It requires an interactive macOS desktop and a user-approved Vercel AI Gateway key. The native controller is a Swift sidecar; no mock controller is used by these checks or by GUI qualification.

## Requirements

- macOS 13 or newer, arm64 or x64.
- Git.
- Node.js 20 or newer. The current LTS is recommended: <https://nodejs.org/>.
- pnpm **10.14.0**, pinned by the repository.
- Swift 5.9 or newer from Xcode Command Line Tools. Xcode is not otherwise required.
- An interactive, unlocked desktop session.
- A Vercel AI Gateway API key. Provider-specific keys are not interchangeable with Gateway keys.

The current qualification commands use the native macOS Accessibility, CoreGraphics, AppKit, and CGEvent APIs. They do not install system software or modify privacy settings automatically.

## Fresh-machine setup

Open Terminal and run:

```bash
git clone <OPENUSE_REPOSITORY_URL> OpenUse
cd OpenUse

node --version
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm --version
swift --version
xcode-select -p

pnpm setup:macos
```

Replace `<OPENUSE_REPOSITORY_URL>` with the repository URL available to the developer. `setup:macos` verifies macOS, architecture, Git, Node, the exact pnpm version, Swift, and Command Line Tools. It then installs the locked workspace dependencies and builds:

```text
native/macos/.build/release/OpenUseMacController
```

If Swift or Command Line Tools are missing, install only the official prerequisite printed by the script:

```bash
xcode-select --install
```

## Required macOS privacy permissions

OpenUse cannot bypass macOS privacy controls. Before GUI qualification, grant both permissions to the process that runs the native controller:

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Add/enable the OpenUse development controller at `native/macos/.build/release/OpenUseMacController`. For a packaged build, add the OpenUse application as well.
3. Open **System Settings → Privacy & Security → Screen & System Audio Recording** (called **Screen Recording** on some versions).
4. Add/enable the same OpenUse/controller process.
5. Quit and relaunch OpenUse if macOS asks for a restart.

The running app shows separate Accessibility and Screen Recording status, fixed buttons to open each System Settings pane, and **Recheck**. A denied grant is a real preflight failure; it is never converted into a connected/qualified result.

## Verification

Run the complete safe preflight:

```bash
pnpm verify:macos
```

It runs qualification-definition checks, environment checks, lint, TypeScript typecheck/tests, the Electron production build, Swift native build/tests, the sidecar JSON-lines smoke test, and the native self-test with required privacy grants. The final line must be:

```text
READY FOR GUI QUALIFICATION
```

Otherwise it prints:

```text
NOT READY FOR GUI QUALIFICATION
```

The protocol-only smoke test can be run while permissions are still pending:

```bash
pnpm native:test:macos
pnpm --filter @openuse/desktop test:macos
```

The latter reports the actual permission state as `granted` or `denied`; it does not claim the native capability passed when it did not.

## Gateway setup and launch

After the preflight passes:

```bash
pnpm dev
```

In OpenUse Settings:

1. Leave **AI provider** as **Vercel AI Gateway**.
2. Select a model whose capability indicators show both **Tool calling** and **Vision**. The current default is `openai/gpt-5.6-luna` with high reasoning, but the selector remains authoritative and is not hardcoded as the only supported model.
3. Paste your own Gateway API key into **API key**.
4. Press **Test connection** and wait for the real Gateway response.
5. Press **Save settings**.

The key is encrypted by Electron `safeStorage` in the main process. It is never returned to the renderer, stored in localStorage, logged, or included in qualification evidence.

## Real qualification

From the repository root:

```bash
pnpm qualify:macos
```

The harness runs the following exact goals three times each:

1. `Open TextEdit and type "Hello from OpenUse"`
2. `Open Calculator and calculate 37 × 19.` — confirm the visible result is `703`.
3. `Open TextEdit, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.`

Enter the exact goal in the OpenUse composer. Do not manually operate the target application; macOS permission decisions are the only expected manual interaction. The harness records a success only when the real model completed the task and the operator confirmed the final visible state. It never injects a click script, performs arithmetic in code, or writes the file through a filesystem shortcut.

The run then guides these checks: Stop and immediate restart, Allow Once, Always Allow, Deny, cancellation while a permission prompt is open, Retina/scale mapping, a real vision-coordinate fallback, and multi-monitor behavior. Change display scaling manually when instructed; the harness never changes it.

## Evidence format

Each run writes only to the gitignored directory:

```text
.openuse/qualification/run-<timestamp>/
  session.json
  events.jsonl
  results.json
  report.md
```

The report contains the exact model ID, attempt result, action count, accessibility-native actions, element-coordinate fallbacks, vision-coordinate fallbacks, coordinate/keyboard input counts, retries, stale recoveries, permission prompts, duration, monitor count, and scale metadata. It does not contain screenshots, model messages, chain-of-thought, API keys, passwords, full typed values, or accessibility values.

## Coordinate model

macOS Accessibility bounds and CGEvent input use global desktop **points**. CoreGraphics screenshots contain physical pixels. Every screenshot result includes `captureBounds`, `coordinateSystem: global-screen-points`, `scaleFactor`, and image dimensions so a visual coordinate can be mapped as:

```text
desktopX = captureBounds.x + imageX × captureBounds.width / imageWidth
desktopY = captureBounds.y + imageY × captureBounds.height / imageHeight
```

The native self-test records each display's bounds, pixel dimensions-derived scale, DPI-equivalent value, and primary status. Mixed-scale multi-monitor behavior must be explicitly tested; it is not inferred from a single-monitor run.

## Troubleshooting

- `ACCESSIBILITY_PERMISSION_REQUIRED`: add the exact native controller path to Accessibility, then relaunch or press **Recheck**.
- `SCREEN_RECORDING_PERMISSION_REQUIRED`: add the exact native controller/OpenUse process to Screen Recording, then relaunch or press **Recheck**.
- `NATIVE_ENGINE_OFFLINE`: run `pnpm native:build:macos`; do not set `OPENUSE_NATIVE_ENGINE_PATH` unless intentionally testing another binary.
- `MODEL_UNSUPPORTED`: select a Gateway catalog model with both Tool calling and Vision.
- Gateway authentication failure: verify that the value is a Vercel AI Gateway key, press **Test connection**, and do not paste the key into logs or source files.
- A stale element failure: let the agent inspect the changed window again. The native controller refuses to reuse an invalid element handle.

## Checklist

```text
[ ] verify:macos passes
[ ] Gateway connection passes
[ ] TextEdit 3/3
[ ] Calculator 3/3
[ ] Save As 3/3
[ ] Stop tested twice
[ ] Allow Once tested
[ ] Always Allow tested
[ ] Deny tested
[ ] permission-dialog cancellation tested
[ ] Retina/scale mapping tested
[ ] vision fallback tested
[ ] multi-monitor tested or marked unavailable
```

No item may be checked from a mock, browser preview, or protocol-only smoke test.
