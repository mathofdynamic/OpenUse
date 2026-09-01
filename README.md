# OpenUse

OpenUse is a local-first, AI-agnostic Computer Use runtime for Windows. A user chooses a model, describes a task, and the model can operate the PC only through OpenUse's typed tools, permission layer, and Windows UI Automation controller.

The first vertical slice is intentionally small:

- Vercel AI Gateway as the first model provider.
- A manually controlled, one-step-at-a-time agent loop with a 30-action limit.
- Windows UI Automation with semantic element interaction before coordinate fallback.
- A .NET 8 Windows sidecar connected to Electron over JSON-lines on stdin/stdout.
- Local application permissions (`ALLOW`, `ASK`, `DENY`) and approval for high-risk actions.
- Electron `safeStorage` for the Gateway key; the key is never returned to the renderer or written to ordinary settings.

## Quick start on Windows

Prerequisites: Node.js 20+, pnpm 10+, .NET 8 SDK, and a Windows desktop session.

```bash
pnpm install
pnpm native:build
pnpm dev
```

Development automatically resolves `native/windows/publish/OpenUse.WindowsController.exe`. Set `OPENUSE_NATIVE_ENGINE_PATH` only when the sidecar lives elsewhere.

Open Settings, choose a model with both tool calling and vision, and enter your own `AI_GATEWAY_API_KEY`. The key is encrypted with the Windows-backed Electron `safeStorage` provider.

The repository can build the TypeScript/Electron shell on macOS and Linux, but OpenUse does not implement cross-platform control yet. On a non-Windows host the UI starts with the Windows engine marked unavailable; no fake computer actions are performed.

## In-scope scenarios

After building the Windows sidecar, these are the acceptance scenarios:

1. `Open Notepad and type "Hello from OpenUse"`.
2. `Open Calculator and calculate 37 × 19`, with the visible result verified through a fresh UI observation.
3. `Open Notepad, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.`

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
docs               Architecture, safety, development, and research notes
```

Read [docs/architecture.md](docs/architecture.md), [docs/computer-use.md](docs/computer-use.md), and [docs/security.md](docs/security.md) before extending the runtime.
