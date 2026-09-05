# OpenUse v0.2 gap audit

Audit basis: the v0.2 product brief, current README and architecture/security/computer-use documentation, the shared TypeScript runtime, both native controllers, the Electron packaging scripts, and the OCD design records.

## Implemented

- One shared Electron/React/TypeScript product for Windows and macOS.
- Provider-neutral `ComputerController`, agent loop, permission engine, high-risk approval, Stop/cancellation, stale-element recovery, semantic UI Automation/Accessibility, and bounded screenshot fallback.
- Settings schema v3 migration. Existing model, Gateway key, and app permissions remain intact.
- Monochrome token system with one selected primary color, curated presets, HEX validation, contrast-aware foreground treatment, live update, and persisted appearance settings.
- Transparent BrowserWindow configuration with macOS vibrancy request, Windows Acrylic request when exposed by Electron, neutral fallback material, blur/opacity controls, and crisp content surfaces.
- Responsive Control Room and responsive Settings states for large, medium, compact, narrow, and short-height windows.
- Live Vercel AI Gateway model discovery through the official `/v1/models` contract, Zod validation, six-hour cache, manual refresh, and bundled fallback.
- Searchable model picker with provider filtering, Computer Use-compatible default view, Show all mode, capability badges, incompatibility explanations, context data, and current pricing.
- Provider-neutral reasoning effort selection: Provider default, None, Minimal, Low, Medium, High, and XHigh where the model metadata supports them. Unsupported values fall back to Provider default.
- Gateway request-cost extraction from validated `providerMetadata.gateway.cost`, live task/lifetime cost events, request deduplication, and privacy-safe usage ledger.
- Approximate 20-step estimator using recent local token profile and candidate model pricing, with explicit `≈` wording and unknown-pricing handling.
- Custom OpenAI-compatible endpoint with Ollama and LM Studio presets, optional secure key, capability configuration, and unknown-cost display.
- Cross-platform click-through Agent Cursor overlay with semantic target geometry, display and coordinate-system telemetry, DPI mapping, reduced-motion behavior, action pulses, and Stop/idle hiding.
- Windows .NET sidecar packaging inside an x64 NSIS installer. Production resolution uses packaged resources.
- Deterministic tests for settings migration/clamping, catalog parsing/cache, pricing tiers, reasoning fallback, Gateway cost metadata, usage accumulation/deduplication, cursor geometry, and native protocol behavior.
- v0.2 documentation and updated OCD visual evidence.

## Partially implemented or pending evidence

- Real Windows Gateway-backed GUI qualification is implemented by `pnpm qualify:windows` but was not executed in this automation session because the available computer-control surface exposes browser tabs, not native Windows app controls. No task result below is inferred from protocol or browser checks.
- Installed Windows launch, packaged resource resolution, native sidecar preflight, and native tests are verified; this is not equivalent to a completed Notepad/Calculator/Save As qualification.
- The live model catalog was fetched and parsed during this pass. A real second-provider model request still requires an interactive Gateway key and GUI/runtime session.
- Reasoning request metadata logging is available in development mode, but the actual selected-level provider request has not been proven without a live model-backed task.
- The current host has one monitor and was observed at 125% scale. 100% and multi-monitor physical alignment remain untested.
- macOS shared-source parity is maintained and the Swift protocol is updated, but macOS build/GUI qualification requires a Mac.
- CI matrix coverage was not added because the repository had no existing workflow and live GUI checks must remain outside normal CI; platform-native build checks should be added in a dedicated follow-up if CI ownership is available.

## Missing from the original product goal

- None of the requested v0.2 shared product features is intentionally omitted from the implementation. The remaining gaps are validation or release hardening rather than an alternate product architecture.
- Public distribution signing, notarization, auto-update, and installer code-signing are not part of this local qualification package.
- Provider-specific capability accuracy for arbitrary custom endpoints cannot be inferred automatically; the user must configure tool/vision support.

## Intentionally excluded

- Arbitrary shell commands, unrestricted PowerShell, unrestricted filesystem APIs, credential capture, hidden remote access, automatic software installation, invisible background control, network-listening agent servers, and bypasses around app permissions.
- Persistent storage of commands, screenshots, passwords, accessibility trees, private window text, file contents, or chain-of-thought.
- A second divergent Windows or macOS UI/product, duplicated provider stacks, or hardcoded task-specific automation.

## Acceptance interpretation

Only an interactive run with the real model, native controller, visible target application, and operator-confirmed result can mark the three Windows scenarios as 3/3. Build, unit, sidecar, installer, and browser-preview evidence remain separate categories.
