# Security model

Computer Use is powerful. OpenUse keeps the model inside a typed, local runtime with explicit application and action boundaries.

## Credentials and provider configuration

- Gateway and custom-provider keys are encrypted with Electron `safeStorage` in the main process.
- Ordinary settings contain only provider selection, model/configuration metadata, and an `apiKeyConfigured` status.
- The renderer can submit a key for encryption but cannot read it back; there is no `getApiKey` IPC method.
- Keys are not written to localStorage, source, Git, logs, crash metadata, model-visible messages, or qualification evidence.
- Custom endpoint URLs are limited to HTTP(S) settings and are treated as user configuration, not as a shell or filesystem capability.

## Runtime policy

- The model can call only the typed Computer Use tools.
- There is no shell, PowerShell, arbitrary filesystem API, browser extension, network listener, or remote-control tool.
- Unknown applications default to `ASK`; `Password Manager` is seeded as `DENY`.
- `Allow Once` is session-scoped. `Always Allow` is persistent only for ordinary application control.
- Delete/remove, submit/send/purchase, permission changes, and credential-like targets require a one-action high-risk approval.
- Credential/password entry is blocked by the agent and checked again by the native controller.
- Stop aborts the model request, cancels queued work, rejects pending native calls, sends the internal cancellation message, and hides the Agent Cursor.

## Usage privacy

The local usage ledger stores only task-level operational metadata: timestamp, provider/model ID, reasoning level, status, step/action counts, input/output token counts, known actual request cost, request count, and duration. It does not store the user command, screenshots, file contents, passwords, accessibility trees, full typed text, or model chain-of-thought. Cost is labeled as spend recorded through this OpenUse installation, not as an account-wide Gateway bill.

The separate local thread store retains the task command and safe task metrics
needed to show history and continue work in the selected thread. It never
retains screenshots, accessibility trees, credentials, private window text, or
chain-of-thought. Long thread context is compacted before it is sent back to a
model; visible local history is not deleted.

Development request diagnostics are opt-in through `OPENUSE_DEBUG_AI_REQUESTS=1` and contain only model ID, provider, and selected reasoning effort. They never include keys or prompt content.

## Data leaving the machine

Only the user command, bounded observations needed for reasoning, and explicitly requested reduced screenshots are sent to the selected provider endpoint. The virtual cursor is local and receives geometry only. No continuous screenshot stream is maintained.
