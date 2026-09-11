# OpenUse

OpenUse is a local-first, AI-agnostic Computer Use runtime for macOS and Windows. A user chooses a model, gives it a natural-language task, and OpenUse operates the desktop through a typed, permission-checked controller.

OpenUse keeps the model boundary and the computer boundary separate:

- native accessibility is preferred over coordinates;
- screenshots are requested only when visual reasoning needs them;
- every action passes through `ALLOW`, `ASK`, `DENY`, and high-risk approval rules;
- the user can stop an active task at any time;
- the model never receives unrestricted shell, PowerShell, filesystem, credential, or remote-control access.

## v0.2.0

The v0.2 product pass preserves the existing Electron/React/TypeScript, agent, permission, and native-controller architecture while adding:

- one responsive Control Room UI for both platforms;
- monochrome tokens with one user-selected primary color;
- native-backed translucent window material with adjustable blur and background opacity;
- dynamic Vercel AI Gateway model discovery with a six-hour local cache and bundled fallback;
- searchable, provider-filtered Computer Use model selection;
- provider-neutral reasoning controls;
- actual Gateway request-cost capture, task spend, lifetime spend, and a privacy-safe local usage ledger;
- per-task local threads with continuation context, folders, history, and bounded transcript compaction;
- an optional OpenUse Agent Cursor overlay that visualizes semantic actions without moving or hijacking the physical pointer;
- one custom OpenAI-compatible endpoint path for advanced and local models;
- named local subscription runtimes for Codex, Claude Code, and OpenCode;
- an x64 Windows NSIS installer containing the real .NET controller.

The live Gateway catalog contained 373 entries on 2026-09-05. The parser classified 251 language models and 155 Computer Use-compatible models at that point; the catalog is intentionally refreshed at runtime rather than treated as permanent source code.

## Quick start

Requirements: Node.js 20 or newer and pnpm 10.14.0. Gateway-backed tasks need a Vercel AI Gateway key. Codex, Claude Code, and OpenCode tasks use the corresponding authenticated local CLI subscription instead of a Gateway key.

Windows:

```powershell
pnpm setup:windows
pnpm verify:windows
pnpm dev
```

macOS:

```bash
pnpm setup:macos
pnpm verify:macos
pnpm dev
```

Configure the provider, key, compatible model, and permissions in **Settings**. The key is encrypted through Electron `safeStorage` in the main process and is never returned to the renderer.

For named subscriptions, install and authenticate the provider with its own CLI, then choose it in **Settings > AI** and use **Check connection**:

```text
Codex:     codex login
Claude:    claude auth login
OpenCode:  opencode auth login
```

The optional model ID and executable path are passed to that local runtime. OpenCode must be installed separately; OpenUse does not install software automatically.

## Packaging

Windows packaging produces an x64 NSIS installer containing the published .NET sidecar:

```powershell
pnpm dist:windows
```

The installer is written to `dist/windows/` and is intentionally ignored by Git. Installed production code resolves the sidecar from packaged resources; it does not depend on a repository path.

The macOS arm64 path remains supported:

```bash
pnpm dist:macos
```

The macOS package uses the shared renderer and agent. Its Swift controller remains a bundled native sidecar. Local packaging uses the existing ad-hoc signing path; Developer ID signing and notarization are separate release work.

## Product architecture

```text
OpenUse Electron / React
        |
        +-- main-process runtime, secure storage, usage ledger, cursor overlay
        |
        +-- ComputerUseAgent
        |       +-- Vercel AI Gateway catalog/provider
        |       +-- custom OpenAI-compatible provider
        |       +-- Codex / Claude Code / OpenCode named subscription adapters
        |       +-- per-task localhost MCP bridge exposing guarded computer tools
        |       +-- typed tools and provider-neutral reasoning
        |       +-- permissions and high-risk approvals
        |
        +-- ComputerController
                +-- Windows .NET UI Automation / Win32 sidecar
                +-- macOS Swift Accessibility / CoreGraphics sidecar
```

Both native controllers implement the same JSON-lines protocol and expose normalized target geometry, display, and interaction-method telemetry. See [docs/architecture.md](docs/architecture.md) and [docs/computer-use.md](docs/computer-use.md).

## Safety and privacy

OpenUse deliberately prohibits arbitrary shell commands, unrestricted PowerShell, unrestricted filesystem APIs, credential capture, automatic software installation, hidden remote access, and invisible background control. Unknown applications require approval. Sensitive and destructive actions require an additional runtime approval and cannot be permanently allowed.

The usage ledger stores model ID, provider, reasoning level, timestamps, status, step/action counts, token counts, known request cost, and duration. It does not store the command, screenshots, passwords, accessibility trees, file contents, or chain-of-thought. See [docs/security.md](docs/security.md) and [docs/V0_2_USAGE_AND_COST.md](docs/V0_2_USAGE_AND_COST.md).

## Development and qualification commands

```text
pnpm dev
pnpm verify
pnpm verify:windows
pnpm verify:macos
pnpm qualify:windows
pnpm qualify:macos
pnpm dist:windows
pnpm dist:macos
```

`verify:*` performs deterministic and native preflight checks. `qualify:*` is an explicit real-desktop harness: it does not inject clicks, calculate outcomes, or use mock agent responses. Complete Windows evidence is documented in [docs/V0_2_WINDOWS_QUALIFICATION.md](docs/V0_2_WINDOWS_QUALIFICATION.md). macOS GUI qualification must be performed on a real Mac; a Windows build cannot prove it.

## Repository layout

```text
apps/desktop          Electron shell, IPC, settings, usage, cursor, React UI, and named runtimes
packages/agent        Closed-loop Computer Use agent
packages/ai           Model catalog, Gateway/custom model providers, pricing, reasoning
packages/computer     OS-neutral controller contract and adapters
packages/permissions  Application and action permission engine
packages/protocol     Shared JSON-lines protocol types
packages/shared       Shared domain types and runtime contracts
native/macos          Swift Accessibility/CoreGraphics controller
native/windows        .NET Windows UI Automation controller
docs                  Architecture, security, setup, and qualification guides
.ocd-designer         v0.2 visual system and design evidence
```

OpenUse is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
