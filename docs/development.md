# Development

## TypeScript and Electron

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` starts the Vite renderer and Electron shell. In an unpackaged Windows development run it automatically resolves `native/windows/publish/OpenUse.WindowsController.exe`; set `OPENUSE_NATIVE_ENGINE_PATH` when using another location. The Electron main process launches the sidecar on the first task, not at application startup.

## Windows sidecar

Install the .NET 8 SDK on Windows, then run:

```powershell
pnpm native:build
pnpm native:test
pnpm test:windows
$env:OPENUSE_NATIVE_ENGINE_PATH = "$PWD\\native\\windows\\publish\\OpenUse.WindowsController.exe"
pnpm dev
```

The sidecar is Windows-only and requires an interactive desktop session. It is not a service and does not open a TCP port. Task cancellation uses an internal JSON-lines `cancel` message so the sidecar can remain alive and drain the interrupted native action before the next task; application shutdown performs a final hard sidecar shutdown.
`pnpm test:windows` is a non-destructive JSON-lines smoke test: it checks malformed input, unknown methods, invalid window IDs, `listWindows`, structured `wait`, cancellation, reuse after cancellation, and graceful shutdown. It does not manipulate the desktop.

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

## Current verification environment

The development workspace used for this pass is macOS on an external volume. Node/pnpm, TypeScript, Vitest, Electron build, Electron boot, and a Windows-targeted native cross-build can be verified here. A Windows desktop session is unavailable here, so native test execution, UI Automation, and physical scenarios remain explicitly unverified until run on Windows.

The native controller declares `PerMonitorV2` DPI awareness. UI Automation bounds, pointer coordinates, and screen captures are expressed in virtual-screen physical pixels. Captures also report their `dpi`, source (`screen` or `window`), reduced image dimensions, and original physical `captureBounds` to the agent. Mixed-DPI multi-monitor behavior still requires a Windows acceptance run.
