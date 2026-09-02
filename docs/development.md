# Development

## TypeScript and Electron

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` starts the Vite renderer and Electron shell. In an unpackaged run it resolves the native controller for the current host: `native/windows/publish/OpenUse.WindowsController.exe` on Windows or `native/macos/.build/release/OpenUseMacController` on macOS. Set `OPENUSE_NATIVE_ENGINE_PATH` when intentionally testing another controller. macOS runs a safe self-test at startup so missing privacy grants are visible before a task can run.

## Windows sidecar

For a fresh Windows 10/11 x64 machine, use the turnkey setup and preflight:

```powershell
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm setup:windows
pnpm verify:windows
```

`setup:windows` checks prerequisites, installs the locked workspace dependencies, and publishes the sidecar. It does not install system software or change the machine. `verify:windows` runs all non-GUI checks and the non-invasive sidecar self-test; it reports `READY FOR GUI QUALIFICATION` only when every check passes.

The individual commands remain useful when diagnosing one layer:

```powershell
pnpm install --frozen-lockfile
pnpm native:build
pnpm native:test
pnpm test:windows
$env:OPENUSE_NATIVE_ENGINE_PATH = "$PWD\\native\\windows\\publish\\OpenUse.WindowsController.exe"
pnpm dev
```

The sidecar is Windows-only and requires an interactive desktop session. It is not a service and does not open a TCP port. Task cancellation uses an internal JSON-lines `cancel` message so the sidecar can remain alive and drain the interrupted native action before the next task; application shutdown performs a final hard sidecar shutdown.
`pnpm test:windows` is a non-destructive JSON-lines smoke test: it checks malformed input, unknown methods, invalid window IDs, `listWindows`, structured `wait`, cancellation, reuse after cancellation, and graceful shutdown. It does not manipulate the desktop.

`pnpm qualify:windows` launches an explicit qualification-mode desktop, guides the three required scenarios three times each, and records operator-confirmed results in `.openuse/qualification/run-<timestamp>/`. `pnpm dev:qualify` is the lower-level development entry point when inspecting the qualification panel without the scenario runner.
`pnpm test:qualification` validates that all three machine-readable scenario definitions retain the 30-action limit, three-run target, and goal-only criteria.

## Manual acceptance matrix

Run the desktop on Windows and verify:

1. Notepad: launch, inspect, find the edit control, type `Hello from OpenUse`, inspect again.
2. Calculator: launch, enter `37 × 19` through the GUI, inspect the result `703`.
3. Notepad save: type `OpenUse test file`, open Save through the UI, enter `openuse-test.txt` in the Desktop location, and verify the final window/title state.

For each scenario check the activity timeline, stop button, permission prompt, and error recovery. Do not use a developer mouse or coordinate-only script as the primary test.

High-risk actions must be approved for the current action. “Always allow” is available for ordinary application control, but not for sensitive or destructive actions. Credential-like targets are blocked by the agent and checked again by the Windows controller.

## Verification commands used for this pass

From the repository root:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The production Electron smoke check was run from `apps/desktop` with the harness-only `ELECTRON_RUN_AS_NODE` variable removed:

```bash
env -u ELECTRON_RUN_AS_NODE pnpm exec electron .
```

The process opened successfully and was stopped with Ctrl-C. Browser-preview UI checks used the Vite server at `http://127.0.0.1:5173` for the initial, settings, filled-composer, and narrow responsive states. The preview does not expose the desktop bridge, so it correctly reports Windows control as unavailable and cannot perform fake actions.

The Windows-targeted native projects were cross-built on the development host with .NET 10.0.400, but native tests and UI Automation cannot execute on macOS. Run `pnpm native:test` and `pnpm test:windows` on Windows before shipping the sidecar.

The Windows-only commands intentionally refuse to run on macOS or Linux. A future Windows session must run `pnpm verify:windows` rather than treating a cross-build as native qualification.

## macOS controller

On macOS, run:

```bash
pnpm setup:macos
pnpm verify:macos
pnpm dev
```

The Swift sidecar is built with the system Swift toolchain and uses `AXUIElement`/ApplicationServices for accessibility, AppKit/NSWorkspace for applications and windows, CoreGraphics for display capture and input, and CGEvent keyboard/mouse events only as fallbacks. Grant Accessibility and Screen Recording to the OpenUse development process in System Settings > Privacy & Security; the application has buttons to open each pane and a Recheck action. `pnpm test:macos` checks protocol behavior even when privacy grants are not present; `pnpm verify:macos` requires both grants and will report `NOT READY FOR GUI QUALIFICATION` otherwise.

The macOS coordinate model is global desktop points for accessibility bounds and CGEvent input. Captures are physical-pixel images with a `scaleFactor`; the agent receives the explicit mapping between image pixels and point-space capture bounds. The self-test records monitor count, bounds, and scale without moving the pointer or changing display settings.

`pnpm qualify:macos` runs the three TextEdit/Calculator goals three times each and writes redacted evidence under `.openuse/qualification/`. It also guides Stop, permission, Retina, vision-fallback, and multi-monitor checks. It never injects an action sequence or infers a visible success.

## Current verification environment

The development workspace used for this pass is macOS on an external volume. Node/pnpm, TypeScript, Vitest, Electron build, Electron boot, and a Windows-targeted native cross-build can be verified here. A Windows desktop session is unavailable here, so native test execution, UI Automation, and physical scenarios remain explicitly unverified until run on Windows.

The native controller sets `PerMonitorV2` before initializing UI Automation or screen APIs. UI Automation bounds, pointer coordinates, and screen captures are expressed in virtual-screen physical pixels. Captures also report their `dpi`, source (`screen` or `window`), reduced image dimensions, and original physical `captureBounds` to the agent. Mixed-DPI multi-monitor behavior still requires a Windows acceptance run.
