# OpenUse Windows testing

This guide is for an interactive Windows 10/11 x64 desktop. Cross-building the .NET project from another OS is not Windows GUI qualification.

## Requirements

- Windows 10 or Windows 11 x64 with an unlocked interactive desktop session.
- Node.js 20 or newer; Node 20 or 22 LTS is recommended.
- pnpm 10.14.0.
- .NET 8 SDK with Windows Desktop targeting packs.
- A Vercel AI Gateway key configured through OpenUse Settings.

## Setup and preflight

```powershell
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm setup:windows
pnpm verify:windows
```

The last line must end with `READY FOR GUI QUALIFICATION`. It runs qualification-definition validation, environment checks, lint, typecheck, TypeScript tests, Electron build, native publish, native .NET tests, and the sidecar IPC/self-test. The self-test is non-invasive and does not move the mouse or type into an application.

## Development and installed builds

For a development run:

```powershell
pnpm dev
```

For the production resource path required by this release:

```powershell
pnpm dist:windows
```

Install the generated `OpenUse-Setup-0.2.0-x64.exe` from `dist/windows/`. The installed controller must be present below `resources\native\windows\OpenUse.WindowsController.exe`. Do not use a repository-relative controller path for the installed-app test.

## Configure OpenUse

1. Open **Settings → AI**.
2. Choose **Vercel AI Gateway**.
3. Select a model marked **Tool calling** and **Vision**.
4. Enter the Gateway key and press **Test connection**.
5. Save the settings.

The model picker starts with Computer Use-compatible models, supports search and provider filtering, and exposes **Show all models** for inspection. Models without tools or visual input explain the incompatibility instead of failing silently.

## Required real task runs

Run `pnpm qualify:windows` and enter the exact goals shown by the harness. Repeat each three times:

1. `Open Notepad and type "Hello from OpenUse"`
2. `Open Calculator and calculate 37 × 19.` Verify visible result `703`.
3. `Open Notepad, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.`

Do not manually click, type, or calculate in the target application. Permission decisions are the only expected manual interaction. The harness counts a pass only when the real runtime completes, the model reports required capabilities, and the operator confirms the fresh visible result.

## What to inspect during a task

- Current model and reasoning level.
- Live task spend after each model request and lifetime spend.
- Agent Cursor target, motion, click pulse, semantic-action visibility, and disappearance after completion/Stop.
- Activity timeline and actual interaction method.
- Inspector geometry, display, screenshot origin/dimensions, and DPI in qualification mode.
- No horizontal overflow or clipped composer/approval controls at 1440, 1100, 800, and 520px widths, plus a short-height window.

## Reliability checks

Run and record:

- Stop twice during active tasks, including a permission prompt; verify request abort, no later native action, hidden cursor, reusable sidecar, and immediate second-task start.
- Unknown app: `Allow Once`, `Always Allow`, `Deny`, and cancellation during approval.
- Display scaling at 100% and 125% or 150%.
- A genuine vision-coordinate fallback after semantic lookup cannot identify a target.
- A secondary-monitor task when more than one monitor is connected. If there is one monitor, record `NOT TESTED — single-monitor machine`.
- The default Gateway model and a different provider/model.
- At least two reasoning levels on a model that advertises configurable reasoning. Confirm the selected level in development request metadata; never expose chain-of-thought.

## Evidence and privacy

Qualification output is written under the ignored `.openuse\qualification\run-<timestamp>\` directory. It records safe operational metadata only: model/provider, reasoning level, status, counts, methods, target geometry, monitor/DPI data, cost, and duration. It does not store commands, screenshots, passwords, full typed values, accessibility trees, or model messages.

The authoritative v0.2 evidence from the current implementation pass is in [V0_2_WINDOWS_QUALIFICATION.md](V0_2_WINDOWS_QUALIFICATION.md). A passing preflight, installed launch, or protocol smoke test must not be reported as a real task pass.
