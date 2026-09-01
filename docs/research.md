# Reference research

Research was performed against the public repositories on 2026-09-01.

- T3 Code `b883fc066ea5c9bebbe1c3e9b4bc2471aab3685f` — MIT
- OpenAI Codex `3a04482645b695085f4daf7c6310ab8592653fea` — Apache-2.0
- Vercel AI `8b6b756a2e2cbe6b8665cf3c0a28e2d524dbf9b0` — Apache-2.0

## T3 Code: boundaries worth adopting

T3 Code separates its Electron shell, React client, local server/runtime, contracts, and provider adapters. Its server is the execution boundary: clients dispatch typed commands and do not call provider processes, terminals, or filesystem capabilities directly. Provider configuration is separated from live instances through a driver and adapter registry. Long-running follow-up work uses queue-backed workers with a drain primitive so tests can wait for quiescence instead of sleeping.

For OpenUse this becomes a smaller main-process runtime: Electron main owns the agent, native child process, IPC handlers, and secrets; React receives typed snapshots and event updates only. We keep the same useful separation without copying T3's event-sourced workspace/VCS system, remote environments, or provider drivers.

T3's desktop code also wraps Electron `safeStorage`, and its IPC layer registers narrow handlers rather than exposing Electron primitives to the renderer. OpenUse follows that pattern with a small `contextBridge` API and a safe-storage-backed secret file.

References: [overview](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md), [workspace layout](https://github.com/pingdotgg/t3code/blob/main/docs/internals/workspace-layout.md), [providers](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md), [safe storage](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/electron/ElectronSafeStorage.ts), and [IPC](https://github.com/pingdotgg/t3code/blob/main/apps/desktop/src/ipc/DesktopIpc.ts).

## OpenAI Codex: safety and evidence lessons

The public Codex code exposes Computer Use configuration as a capability with per-application Windows rules (AUMIDs and executable identity), rather than an unrestricted process primitive. Its MCP path separates tool-call transport from approval/Guardian review, and its bounded `node_repl`/`cua_repl` evidence treats completed tool output as untrusted evidence. Screenshot retention is bounded and multimodal evidence is explicitly enabled.

The repository does not provide the complete native Computer Use implementation requested here. The packaged `@oai/sky`/controller stack is outside the public implementation, so OpenUse uses only the public design lessons: a runtime-owned policy boundary, explicit approval, bounded evidence, and no dependency on Codex binaries. OpenUse's first policy is deliberately simpler: local app permissions plus a high-risk action hook, with no shell, filesystem, or remote-control tools.

References: [Computer Use config](https://github.com/openai/codex/blob/main/codex-rs/config/src/computer_use.rs), [public Computer Use protocol types](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/typescript/v2), [bounded REPL evidence](https://github.com/openai/codex/blob/main/codex-rs/core/src/context/node_repl_review_evidence.rs), [MCP approval routing](https://github.com/openai/codex/blob/main/codex-rs/core/src/mcp_tool_call.rs), and [Guardian boundary](https://github.com/openai/codex/blob/main/codex-rs/core/src/guardian/mod.rs).

## Vercel AI SDK and Gateway: current API choices

The checked-out AI SDK is v7.0.87. The Gateway provider is part of the `ai` package: `createGateway({ apiKey })` creates a provider instance, and a `provider/model` string is the supported model identifier shape. The current tool API uses `tool({ inputSchema })`; `ToolLoopAgent` exists, but the manual-loop cookbook is a better fit for OpenUse because it permits one model step, serial tool execution, runtime permission waits, and cancellation between every action.

Multimodal tool results use `toModelOutput` and the canonical `file` content part with inline data. OpenUse only sends screenshots when the model explicitly calls `computer_capture_screen`; screenshots are not logged or continuously streamed.

References: [Gateway provider](https://github.com/vercel/ai/blob/main/content/providers/01-ai-sdk-providers/00-ai-gateway.mdx), [manual agent loop](https://github.com/vercel/ai/blob/main/content/cookbook/05-node/55-manual-agent-loop.mdx), [ToolLoopAgent](https://github.com/vercel/ai/blob/main/content/docs/07-reference/01-ai-sdk-core/16-tool-loop-agent.mdx), and [multimodal tool results](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx).

## Decisions derived from the research

1. Use a single local Electron main-process runtime instead of a network server for the MVP.
2. Keep the native controller behind an OS-neutral `ComputerController` interface and a typed JSON-lines protocol.
3. Use a manual AI SDK loop with `generateText`, one step at a time, with a 30-tool-call cap.
4. Make permissions and high-risk approval runtime-owned; the model never supplies an authoritative risk classification.
5. Keep the public app independent of T3 Code and Codex source and preserve research-only attribution.
