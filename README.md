# OpenUse

OpenUse is a local-first, AI-agnostic Computer Use runtime for macOS and Windows. You give it a natural-language task, choose a model, and it operates the desktop through a small, permission-checked tool surface.

OpenUse is designed to make computer control observable and bounded:

- the model never receives unrestricted shell or filesystem access;
- native accessibility is preferred over coordinates;
- every action passes through the OpenUse permission and safety layer;
- screenshots are requested only when visual reasoning is needed;
- the user can stop an active task at any time.

## Current status

OpenUse is an MVP development release. The macOS controller is available for real local testing. Windows support is implemented behind the same platform-neutral controller contract; native Windows GUI qualification must be run on Windows 10/11 x64.

The first supported model provider is [Vercel AI Gateway](https://vercel.com/ai-gateway). OpenUse does not hardcode a model or provider-specific Computer Use logic.

## What it can do

The initial qualification tasks are:

1. Open TextEdit and type `Hello from OpenUse`.
2. Open Calculator, enter `37 × 19`, and verify the visible result `703`.
3. Open TextEdit, type `OpenUse test file`, and save it as `openuse-test.txt` on the Desktop.

These are real closed-loop tasks: observe, reason, request a typed tool, check permissions, execute locally, observe again, and continue until completion.

## macOS quick start

Requirements:

- macOS 13 or newer;
- Apple Silicon arm64 for the packaged MVP build;
- Node.js 20 or newer;
- pnpm 10.14.0;
- Swift 5.9 or newer and Xcode Command Line Tools;
- a Vercel AI Gateway API key;
- Accessibility and Screen Recording permission for the installed OpenUse app.

From the repository root:

```bash
pnpm setup:macos
pnpm dist:macos
```

Install `dist/macos/OpenUse-0.1.0-arm64.dmg` by dragging OpenUse into Applications, then launch `/Applications/OpenUse.app`. Grant the permissions requested by OpenUse under **System Settings → Privacy & Security**. Use the app's **Recheck** control after granting them.

After the app is installed and permissions are granted, run the safe automated preflight:

```bash
pnpm verify:macos
```

Open **Settings**, keep **Vercel AI Gateway** selected, enter your own Gateway key, select a model marked with both **Tool calling** and **Vision**, and press **Test connection**. The key is stored through Electron `safeStorage` and is never returned to the renderer or written to ordinary settings.

For the full setup, packaging, permission, and qualification workflow, see:

- [macOS testing](docs/MACOS_TESTING.md)
- [macOS packaging](docs/MACOS_PACKAGING.md)
- [macOS qualification record](docs/macos-qualification.md)

## Windows quick start

On a Windows 10/11 x64 development machine:

```powershell
pnpm setup:windows
pnpm verify:windows
pnpm dev
```

The Windows controller is a .NET 8 sidecar using Windows UI Automation and native input APIs. Follow [docs/WINDOWS_TESTING.md](docs/WINDOWS_TESTING.md) for native build, preflight, and three-run GUI qualification. Windows GUI checks are intentionally not run from macOS or Linux.

## Architecture

```text
User command
    ↓
OpenUse agent loop
    ↓
AI provider abstraction
    ↓
Typed Computer Use tools
    ↓
Permission and safety layer
    ↓
ComputerController
    ├── macOS Swift sidecar
    └── Windows .NET sidecar
    ↓
Local applications
```

The Electron main process owns secrets, permissions, the agent runtime, and the native sidecar lifecycle. The renderer is a UI client and does not receive the Gateway key. Native controllers communicate with Electron over private JSON-lines stdin/stdout; no inbound network listener is required.

Both platforms follow the same interaction priority:

1. accessibility inspection;
2. native semantic action or value setting;
3. element-bound coordinate fallback;
4. screenshot/vision coordinate fallback.

Read [docs/architecture.md](docs/architecture.md) and [docs/computer-use.md](docs/computer-use.md) for the implementation details.

## Safety boundaries

OpenUse deliberately does not expose shell execution, PowerShell, arbitrary filesystem APIs, credential entry, software installation, remote control, or a network-accessible agent server.

Application control uses `ALLOW`, `ASK`, and `DENY` permissions. Unknown applications require approval. Destructive, credential-related, permission-changing, purchasing, and external-submission actions have an additional runtime approval boundary. The model cannot override these decisions.

OpenUse records concise activity events rather than chain-of-thought. Qualification telemetry contains action counts, timings, target metadata, interaction methods, retries, and permission events; it omits API keys, screenshots, passwords, and full typed sensitive values.

See [docs/security.md](docs/security.md) for the complete security model.

## Development commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:qualification
```

Platform-specific commands:

```bash
pnpm setup:macos
pnpm verify:macos
pnpm qualify:macos
pnpm setup:windows
pnpm verify:windows
pnpm qualify:windows
```

`qualify:*` commands are explicit real-desktop harnesses. They write redacted evidence below `.openuse/qualification/`, which is ignored by Git. Mocks remain available for deterministic agent and protocol tests.

## Repository layout

```text
apps/desktop          Electron shell, IPC, settings, and React UI
packages/agent        Closed-loop Computer Use agent
packages/ai           Model provider abstraction and Gateway adapter
packages/computer     OS-neutral controller contract and test doubles
packages/permissions  Application and action permission engine
packages/protocol     Shared JSON-lines protocol types
packages/shared       Shared errors and domain types
native/macos          Swift Accessibility/CoreGraphics controller
native/windows        .NET Windows UI Automation controller
docs                  Architecture, security, setup, and qualification guides
```

## License and contributions

OpenUse is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Contributions should preserve the local-first security boundaries, keep the provider and controller abstractions independent, add deterministic tests where possible, and document any platform-specific behavior. Do not commit API keys, screenshots containing private data, packaged binaries, or qualification output.
