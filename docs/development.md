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

```bash
pnpm native:build
pnpm native:test
set OPENUSE_NATIVE_ENGINE_PATH=%CD%\\native\\windows\\publish\\OpenUse.WindowsController.exe
pnpm dev
```

The sidecar is Windows-only and requires an interactive desktop session. It is not a service and does not open a TCP port.

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

`pnpm native:build` and `pnpm native:test` could not run on the development host because it is macOS without the .NET 8 SDK. Run both on Windows before shipping the sidecar.

## Current verification environment

The development workspace used for the first implementation pass is macOS on an external volume. Node/pnpm, TypeScript, Vitest, Electron build, and Electron boot can be verified here. The .NET SDK and Windows desktop session are unavailable here, so the Windows sidecar compile and physical scenarios remain explicitly unverified until run on Windows; the source and native test project are included for that pass.
