# OpenUse architecture

OpenUse is local-first. The renderer is a view and command surface; it does not receive the Gateway key, hold the agent loop, or call Windows APIs.

```mermaid
flowchart TD
    User[User command] --> UI[React renderer]
    UI -->|narrow contextBridge IPC| Main[Electron main runtime]
    Main --> Agent[ComputerUseAgent]
    Agent --> Provider[ModelProvider]
    Provider --> Gateway[Vercel AI Gateway]
    Agent --> Tools[Typed OpenUse tools]
    Tools --> Policy[Permission and risk layer]
    Policy --> Controller[ComputerController]
    Controller -->|JSON-lines over stdin/stdout| Sidecar[Native platform sidecar]
    Sidecar --> Win[Windows .NET 8 UI Automation / Win32]
    Sidecar --> Mac[macOS Swift AXUIElement / CoreGraphics]
    UI -. status/events .-> Main
    Main -->|redacted timeline events| UI
```

## Process ownership

Electron main starts the sidecar only when a task needs it. The sidecar is a child process with private stdin/stdout, no listening socket, and no general shell interface. Each request has an ID and receives exactly one structured response. If the task is stopped, the main process aborts the model request, rejects pending protocol requests, and sends an internal cancellation message; the sidecar drains the cancelled action on its STA worker and stays reusable. Hard termination is reserved for sidecar failure, startup cancellation, or application shutdown.

## Package boundaries

- `packages/shared` contains domain types, error codes, redaction helpers, and timeline contracts.
- `packages/protocol` contains the JSON-lines method/result map and Zod validation for native messages.
- `packages/computer` owns the platform-neutral controller interface, the protocol-backed controller adapter, and deterministic test doubles.
- `packages/permissions` owns app-level access, session approvals, risk classification, and high-risk approval hooks.
- `packages/ai` owns `ModelProvider` and the Gateway implementation. It knows nothing about Windows or the UI.
- `packages/agent` owns tool schemas, observation/action ordering, step limits, cancellation, and concise event summaries.
- `apps/desktop` composes all services, owns Electron lifecycle and secrets, and exposes a narrow renderer API.
- `native/windows` implements Windows observation, UI Automation interaction, keyboard/mouse fallback, and screen capture.
- `native/macos` implements macOS AX observation/actions, AppKit application/window management, CoreGraphics capture, and CGEvent keyboard/mouse fallback.

## Why the native controller is isolated

Windows UI Automation and macOS Accessibility are native, stateful APIs with desktop-session, privacy, and coordinate-system concerns. Keeping each in a sidecar avoids putting OS-specific bindings and failure modes into the renderer, lets the TypeScript agent use one stable contract, and lets a future Linux controller be added without changing the agent.
