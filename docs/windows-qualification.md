# Windows qualification

Status: `PENDING WINDOWS RUN`
Date opened: 2026-09-02

This document is the qualification record for the real Windows Computer Use slice. The implementation pass that created it ran on macOS 26.0.1, so no result below is marked as a Windows pass until it is reproduced in an interactive Windows session.

## Host used for this pass

| Check | Observed value | Qualification meaning |
| --- | --- | --- |
| Host OS | macOS 26.0.1, arm64 | Not a Windows GUI qualification environment |
| Node | v24.18.0 | TypeScript/build checks only |
| pnpm | 10.14.0 | TypeScript/build checks only |
| .NET SDK | 10.0.400 installed locally for cross-build | Compile check only; not a Windows runtime |
| Electron package | 43.4.1 (`ELECTRON_RUN_AS_NODE` removed for boot check) | Desktop build/boot check only |

The Windows-only SDK/sidecar commands were initially unavailable because `dotnet` was not installed. After installing the SDK, the Windows-targeted controller and test project cross-built successfully. A `win-x64` test run cannot execute on this arm64 macOS host, and no UI Automation or real application interaction was claimed.

## Environment

| Check | Required record |
| --- | --- |
| Windows version/build | `TBD` |
| Node | `TBD` |
| pnpm | `TBD` |
| .NET SDK | `TBD` |
| Electron | `TBD` |
| UI Automation assemblies | `System.Windows.Automation` loaded by native build |
| Display scale | Test at 100%, then 125% or 150% if available |
| Monitors | Record single- and multi-monitor behavior |

## Commands

From the repository root on Windows, use the turnkey commands:

```powershell
pnpm setup:windows
pnpm verify:windows
pnpm qualify:windows
```

The exact fresh-machine procedure is in [WINDOWS_TESTING.md](WINDOWS_TESTING.md); the ready-to-paste Windows Codex handoff is in [WINDOWS_CODEX_PROMPT.md](WINDOWS_CODEX_PROMPT.md).

The qualification runner creates `.openuse/qualification/run-<timestamp>/` with `session.json`, `events.jsonl`, `results.json`, and `report.md`. `results.json` records three attempts per goal, the exact model ID and capability metadata, success/failure, action counts, actual UIA/element-coordinate/vision-coordinate methods, retries, stale recoveries, duration, and failure reason. The report is qualified only after 3/3 for each scenario and explicit reliability-check confirmation; a single-monitor environment may explicitly record multi-monitor as unavailable. It never stores screenshots by default.

For lower-level diagnosis, run these from the repository root:

```powershell
node --version
pnpm --version
dotnet --version
pnpm install
pnpm native:build
pnpm native:test
pnpm test:windows
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`test:windows` is a protocol smoke test. It launches the published sidecar, verifies malformed JSON, unknown methods, invalid window IDs, `listWindows`, structured `wait`, cancellation/reuse, and graceful termination. It does not move the mouse or type into applications.

The smoke test also invokes the sidecar `selfTest` command. It must report UI Automation, window enumeration, screen enumeration, screen capture, DPI detection, non-invasive input API initialization, and at least one monitor as available. It captures and disposes of one local screenshot to check the path but never persists or sends its pixels.

## Native build gate on this host

| Check | Result |
| --- | --- |
| `dotnet publish native/windows/OpenUse.WindowsController.csproj -c Release -r win-x64 --self-contained false -o native/windows/publish` | `PASS` cross-build |
| `dotnet build native/windows.tests/OpenUse.WindowsController.Tests.csproj -c Release -r win-x64` | `PASS` cross-build |
| `dotnet test ... -r win-x64` | `NOT RUN`: no x64 .NET host on arm64 macOS |
| `pnpm test:windows` | `NOT RUN`: intentional Windows platform guard |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | `PASS` on this host |

## Scenario results

### Scenario 1 — Notepad typing

Status: `NOT RUN ON WINDOWS`

Record:

```text
Scenario: Notepad typing
Model: TBD — no live Gateway qualification was possible on this host
Result: TBD
Steps: launchApp -> listWindows -> inspectWindow -> clickElement -> typeText -> inspectWindow -> finish
Semantic actions: TBD
Coordinate fallbacks: TBD
Retries: TBD
Duration: TBD
Observed text: TBD
```

### Scenario 2 — Calculator

Status: `NOT RUN ON WINDOWS`

Record whether Calculator is reported as `CalculatorApp`, `Calculator`, or a packaged `ApplicationFrameHost` window. The result must be read from the observed Calculator UI and equal `703`; code-side arithmetic is not evidence.

### Scenario 3 — Notepad Save As

Status: `NOT RUN ON WINDOWS`

Record the foreground window identity before and after Save As, the filename field selector, Desktop navigation, final title/path state, and whether any coordinate fallback was used. Do not verify by adding an arbitrary filesystem tool.

## Reliability checks

- Send malformed and unknown protocol requests; the parent must return a structured error and never hang.
- Cancel a bounded native action; the sidecar should return `TASK_CANCELLED`, remain alive, and accept the next request without a process restart.
- Kill the sidecar during a pending request; Electron must surface `NATIVE_ENGINE_OFFLINE` and a later task must be able to start a fresh sidecar.
- Stop during model work and during the permission dialog; no later native request may be issued for that task.
- Test Enter, Escape, Tab, Shift+Tab, Ctrl combinations, Alt combinations, function keys, and arrows through the bounded key vocabulary.
- Capture a window and the virtual screen at each tested DPI. Record returned image dimensions, `dpi`, `coordinateSystem`, and whether UIA bounds align with the captured pixels.
- Confirm unknown apps ask, denied apps never reach the sidecar, Allow Once is session-scoped, and Always Allow persists only ordinary application control.

## Qualification decision

The current repository is source-ready for Windows qualification but is not release-qualified. Complete this record with actual Windows evidence before claiming the three scenarios or live AI Gateway qualification.
