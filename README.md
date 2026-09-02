# OpenUse

OpenUse is a local-first, AI-agnostic Computer Use runtime for macOS and Windows. A user chooses a model, describes a task, and the model can operate the computer only through OpenUse's typed tools, permission layer, and native accessibility controller.

The first vertical slice is intentionally small:

- Vercel AI Gateway as the first model provider.
- A manually controlled, one-step-at-a-time agent loop with a 30-action limit.
- Native accessibility with semantic element interaction before coordinate fallback (macOS AXUIElement and Windows UI Automation).
- Swift macOS and .NET 8 Windows sidecars connected to Electron over JSON-lines on stdin/stdout.
- Local application permissions (`ALLOW`, `ASK`, `DENY`) and approval for high-risk actions.
- Electron `safeStorage` for the Gateway key; the key is never returned to the renderer or written to ordinary settings.

## Quick start

For a fresh Windows 10/11 x64 machine, follow [docs/WINDOWS_TESTING.md](docs/WINDOWS_TESTING.md). For this Mac qualification path, follow [docs/MACOS_TESTING.md](docs/MACOS_TESTING.md). The Windows short path is:

```powershell
pnpm setup:windows
pnpm verify:windows
pnpm dev
```

Use `pnpm qualify:windows` for the guided, three-run-per-scenario qualification harness. It writes redacted evidence under `.openuse/qualification/`, which is gitignored.

Development automatically resolves `native/windows/publish/OpenUse.WindowsController.exe`. Set `OPENUSE_NATIVE_ENGINE_PATH` only when the sidecar lives elsewhere.

Open Settings, choose a model with both tool calling and vision, and enter your own `AI_GATEWAY_API_KEY`. The key is encrypted with the Windows-backed Electron `safeStorage` provider.

On macOS, `pnpm setup:macos` builds the Swift controller and the Electron app reports the detected macOS privacy grants. Windows remains available through its .NET controller and Windows-specific commands.

## In-scope scenarios

After building the Windows sidecar, these are the acceptance scenarios:

On macOS, the equivalent first qualification scenarios use TextEdit:

1. `Open TextEdit and type "Hello from OpenUse"`.
2. `Open Calculator and calculate 37 × 19`, with the visible result verified through a fresh UI observation.
3. `Open TextEdit, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.`

## Repository map

```text
apps/desktop       Electron main/preload shell and React UI
packages/agent     Closed-loop Computer Use reasoning runtime
packages/ai        Provider abstraction and Vercel AI Gateway adapter
packages/computer  OS-neutral controller contract and test doubles
packages/permissions  Application/action policy engine
packages/protocol JSON-lines contracts shared with the native sidecar
packages/shared    Shared domain types and errors
native/windows     Windows UI Automation and input sidecar
native/macos       macOS Accessibility and CoreGraphics sidecar
docs               Architecture, safety, development, and research notes
```

Read [docs/architecture.md](docs/architecture.md), [docs/computer-use.md](docs/computer-use.md), and [docs/security.md](docs/security.md) before extending the runtime.
