# Security model

OpenUse is local-first, but Computer Use is inherently powerful. The MVP uses explicit boundaries rather than assuming the model is trustworthy.

## Credentials and storage

- The Gateway API key is encrypted with Electron `safeStorage` in the main process.
- Ordinary settings contain only provider/model selection, an `apiKeyConfigured`-style status, and app permissions.
- The renderer can submit a key for encryption but never reads it back; IPC has no `getApiKey` method.
- The key is not placed in localStorage, source, Git, logs, crash metadata, or model-visible messages.

## Runtime policy

- The model can only call the typed OpenUse tools.
- There is no shell, PowerShell, arbitrary filesystem, browser-extension, network-listening, or remote-control tool.
- Unknown applications default to `ASK`; `Password Manager` is seeded as `DENY`.
- `ALLOW`, `ASK`, and `DENY` are stored per application. `Allow Once` is session-scoped; `Always Allow` is persistent.
- High-risk signals are classified by OpenUse from the tool and target, not accepted from model input. Delete/remove, submit/send/purchase, permission changes, and credential-like targets require a user approval even when the application is otherwise allowed.
- Sensitive and destructive approvals are one-action approvals; they are never persisted as `Always allow`.
- Credential/password entry is disabled in this MVP.
- The agent refreshes the target UI state before semantic interaction, and the native controller checks the focused UI Automation control again before text input.
- A stopped task aborts the model request, cancels queued work, rejects pending native calls, and sends an internal cancellation message to the sidecar. The sidecar remains reusable after its bounded STA action drains; it is terminated only for failure, startup cancellation, or application shutdown.

## Data leaving the machine

Only the user command, bounded UI observations needed for reasoning, and explicitly requested reduced screenshots are sent to the selected Gateway model. OpenUse does not create telemetry for screenshots, typed text, file contents, accessibility trees, or API keys. Development logs use redacted summaries and may include action names, durations, model ID, status, and token counts when available.
