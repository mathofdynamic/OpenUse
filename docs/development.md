# Development

## Current host

The v0.2 implementation pass is developed on Windows 11 x64 with Node.js 24, pnpm 10.14.0, and .NET 8. The repository still supports the macOS Swift controller and shared renderer, but macOS native GUI behavior must be verified on a Mac.

## Common checks

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify
```

`pnpm dev` starts the Vite renderer and Electron shell. Development controller resolution uses `native\windows\publish\OpenUse.WindowsController.exe` on Windows and `native/macos/.build/release/OpenUseMacController` on macOS. `OPENUSE_NATIVE_ENGINE_PATH` is an explicit development/test override only.

## Windows

```powershell
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm setup:windows
pnpm verify:windows
pnpm qualify:windows
pnpm dist:windows
```

`setup:windows` checks prerequisites, installs the locked workspace, and publishes the .NET sidecar. `verify:windows` runs the deterministic checks, native tests, and non-invasive sidecar self-test. It does not manipulate the desktop. `qualify:windows` is the explicit operator harness for real model-backed tasks and manual Stop/permission/DPI checks.

The production Windows path resolves the controller from packaged resources. The installer output is under `dist/windows/`; do not commit it.

## macOS

```bash
pnpm setup:macos
pnpm verify:macos
pnpm qualify:macos
pnpm dist:macos
```

The Swift sidecar uses AXUIElement, AppKit, CoreGraphics, and CGEvent fallbacks. Accessibility and Screen Recording permissions must be granted to the installed `/Applications/OpenUse.app` before real qualification. `verify:macos` and `qualify:macos` must run on an interactive Mac; Windows cannot prove macOS GUI qualification.

## Debugging provider requests

For local development-only request inspection:

```powershell
$env:OPENUSE_DEBUG_AI_REQUESTS = "1"
pnpm dev
```

Main-process diagnostics record only provider, model ID, and reasoning level. They do not expose keys, prompts, screenshots, private UI content, or chain-of-thought.

## Architecture constraints

Keep provider logic in `packages/ai`, agent policy in `packages/agent`/`packages/permissions`, platform code in `native/*`, and renderer IPC narrow. Do not add shell, unrestricted filesystem, hidden remote control, or provider-specific branches to the agent. Use atomic persistence for settings, secrets, model cache, and usage.

## Release validation

The final release check must include:

```text
lint, typecheck, unit tests, Electron build
Windows native build/tests/self-test
Windows installer and installed launch
macOS source/build compatibility
```

Real Gateway and GUI acceptance results belong in [V0_2_WINDOWS_QUALIFICATION.md](V0_2_WINDOWS_QUALIFICATION.md) and the corresponding macOS qualification record. A passing build is not a Computer Use task result.
