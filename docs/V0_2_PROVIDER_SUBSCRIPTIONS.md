# OpenUse v0.2 named subscription providers

OpenUse supports two provider families:

| Family | Source of AI | Credential boundary | Cost metadata |
| --- | --- | --- | --- |
| Gateway | Vercel AI Gateway | OpenUse `safeStorage` key | Gateway catalog and request metadata |
| Named subscription | Local Codex, Claude Code, or OpenCode runtime | Provider-owned CLI login | Usually unknown to OpenUse |
| Custom endpoint | One OpenAI-compatible endpoint | OpenUse `safeStorage` key | Unknown unless configured/provided |

## Why the named-runtime boundary

T3 Code's provider architecture separates host orchestration from provider-specific account/runtime adapters. OpenUse follows that boundary in a smaller form:

- `NamedProviderManager` owns executable discovery, read-only health checks, task lifetime, cancellation, model selection, and provider launch arguments.
- The provider CLI owns subscription authentication. OpenUse never asks the user to paste a subscription token into OpenUse.
- `OpenUseMcpBridge` is created for one task on `127.0.0.1` with a random bearer token.
- The bridge delegates to the same `ComputerUseAgent`, permission engine, native controller, and cursor telemetry used by Gateway tasks.
- The provider process is ephemeral and OpenUse does not persist provider sessions, screenshots, accessibility trees, or chain-of-thought.

This keeps Codex, Claude Code, OpenCode, Gateway, and custom endpoint selection inside one shared Computer Use product. It does not create provider-specific desktop-control policy.

## Setup

Install the provider CLI yourself and authenticate it using its documented command:

```text
Codex:     codex login
Claude:    claude auth login
OpenCode:  opencode auth login
```

OpenUse does not auto-install software. In **Settings > AI**, select the named provider, optionally enter a model ID and executable path, save, then choose **Check connection**. A blank model ID means the provider's own default model.

The installed OpenCode CLI is optional. If it is missing, OpenUse reports `Not installed` and leaves Gateway, Codex, and Claude independent.

## Task launch contract

### Codex

OpenUse uses `codex exec --json --ephemeral` with user configuration ignored and Codex automatic review enabled so MCP calls can complete non-interactively. Shell, unified-exec, browser, app, computer-use, plugin, image, and other non-OpenUse features are disabled for this launch. The OpenUse MCP server is configured through the CLI's MCP settings. Selected supported reasoning is passed as `model_reasoning_effort`. The outer automatic review does not replace OpenUse permissions; the bridge still routes every desktop action through OpenUse's policy.

### Claude Code

OpenUse uses non-interactive `claude -p` with stream JSON, session persistence disabled, strict MCP configuration, an explicit OpenUse MCP allowlist, and no built-in tool set. Selected supported effort is passed through the CLI's `--effort` option.

### OpenCode

OpenUse supplies `OPENCODE_CONFIG_CONTENT` for a task-scoped remote MCP server, denies the default tool set, allows only `openuse_*`, disables snapshots, and invokes `opencode --pure run --format json`. The provider's configured/authenticated upstream model remains OpenCode's responsibility.

All three paths require the provider to call `computer_finish` after verifying the result. Otherwise OpenUse marks the task as failed. Stop aborts the child process, closes the bridge, stops the native controller, and hides the Agent Cursor.

## Capability and cost limitations

Named CLIs do not expose the same stable catalog metadata as Gateway. OpenUse therefore shows an optional exact model ID, provider connection state, and `Cost: unknown` rather than inventing pricing. Token counts are parsed only from bounded structured output when present and are retained in memory for the task-level usage event; provider raw output is not persisted.

Reasoning controls are provider-neutral at the product boundary. `Provider default`, `None`, `Minimal`, `Low`, `Medium`, `High`, and `XHigh` are stored in shared settings, but each named adapter translates only the modes it can pass to its CLI. OpenCode currently exposes provider default in the OpenUse UI because its CLI path does not provide a stable provider-agnostic effort flag.

## Safety checks

The MCP bridge is not a bypass around OpenUse safety. It validates tool names and inputs, enforces the action limit, emits the normal action/cursor events, and delegates every action through the existing permission/risk/native-controller path. It does not expose shell commands, arbitrary filesystem access, credential entry, hidden remote access, or an unrestricted browser.

The design is informed by [T3 Code's provider internals](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md), while OpenUse's actual runtime contract remains its own typed controller and permission architecture.
