# OpenUse Windows testing

This is the turnkey path for qualifying the real Windows Computer Use runtime. It must be run on an interactive Windows 10 or Windows 11 x64 desktop. A macOS or Linux build can validate the TypeScript shell and cross-compile the native project, but it cannot qualify UI Automation, screen capture, DPI mapping, or physical application control.

## Requirements

- Windows 10 or Windows 11, x64.
- An unlocked interactive desktop session with a visible display. Do not use a headless service session for GUI qualification.
- Git for Windows: <https://git-scm.com/download/win>.
- Node.js 20 or newer. Node.js 20 or 22 LTS is recommended: <https://nodejs.org/>. The repository declares `node >=20`.
- pnpm **10.14.0**, the version pinned by the repository's `package.json`.
- .NET 8 SDK: <https://dotnet.microsoft.com/download/dotnet/8.0>. The SDK must include the Windows Desktop targeting packs used by WPF and Windows Forms. Visual Studio is not required for this repository; the SDK is sufficient.
- A Vercel AI Gateway key. Use the value supplied as `AI_GATEWAY_API_KEY`; OpenUse stores it through Electron `safeStorage` from Settings and does not read it into the renderer.

The native controller is a framework-dependent `net8.0-windows` `win-x64` executable. The .NET 8 SDK is required to build it. Installing only a .NET runtime is not enough.

## Fresh-machine setup

Open PowerShell and run the following commands from a directory where you keep development projects:

```powershell
git clone <OPENUSE_REPOSITORY_URL> OpenUse
Set-Location .\OpenUse

node --version
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm --version
dotnet --version
dotnet --list-sdks

pnpm setup:windows
```

Replace `<OPENUSE_REPOSITORY_URL>` with the repository URL available to the developer. `setup:windows` checks Windows x64, Git, Node, the exact pnpm version, and the presence of a .NET 8 SDK. It then runs `pnpm install --frozen-lockfile` and publishes the native sidecar. It does not install Windows software, change display settings, or alter system policy.

If a prerequisite is missing, stop and follow the URL printed by the command. In particular, the required native prerequisite is:

```text
.NET 8 SDK is required, including the Windows Desktop targeting packs used by WPF/Windows Forms.
```

## Preflight verification

Run the complete non-GUI verification before opening applications:

```powershell
pnpm verify:windows
```

This runs, in order, the environment check, lint, TypeScript typecheck, TypeScript tests, Electron production build, native Windows publish, native .NET test build/run, and the Windows sidecar JSON-lines smoke test. The smoke test checks malformed requests, unknown methods, invalid window IDs, window enumeration, the non-invasive native self-test, bounded waiting, cancellation, sidecar reuse, and graceful shutdown. It does not move the mouse or type into an application.

The final output must say:

```text
READY FOR GUI QUALIFICATION
```

If any check fails, the command exits nonzero and says:

```text
NOT READY FOR GUI QUALIFICATION
```

Do not continue to GUI qualification after a failed preflight.

The individual commands are also available when diagnosing one layer:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm native:build
pnpm native:test
pnpm test:windows
```

## Configure and launch OpenUse

Start the development desktop after preflight:

```powershell
pnpm dev
```

The development shell resolves the published executable at:

```text
native\windows\publish\OpenUse.WindowsController.exe
```

Set `OPENUSE_NATIVE_ENGINE_PATH` only when intentionally testing a sidecar at another path:

```powershell
$env:OPENUSE_NATIVE_ENGINE_PATH = "$PWD\native\windows\publish\OpenUse.WindowsController.exe"
pnpm dev
```

In OpenUse Settings:

1. Leave the provider as **Vercel AI Gateway**.
2. Select a model whose capability indicators show both **Tool calling** and **Vision**.
3. Paste the value of `AI_GATEWAY_API_KEY` into the password field.
4. Press **Test connection**. The result is one of connected, invalid key, network error, unsupported model, or Gateway error.
5. Press **Save settings**.

The API key is sent only from Electron's main process to the Gateway request path. It is never returned through IPC to the renderer, written to `localStorage`, written to ordinary settings, or logged.

## Interactive qualification

From the repository root, run:

```powershell
pnpm qualify:windows
```

The command runs `pnpm verify:windows` first, creates a unique local run directory, launches OpenUse in explicit qualification mode, and guides the operator through each goal three times. The scenario JSON files under `qualification\scenarios` contain goals and acceptance criteria only; they do not contain click coordinates, element IDs, or a fixed action sequence.

For each attempt:

1. Enter the exact displayed goal in the OpenUse composer.
2. Make no manual target-application clicks, typing, or calculations. Permission decisions are the only expected manual interaction.
3. Wait for OpenUse to reach a terminal state.
4. Confirm the expected visible state from a fresh UI observation and answer the harness prompt `PASS` or `FAIL`.

The harness records a pass only when the runtime emitted `task.finished` with `completed`, the selected model reported both required capabilities, and the operator explicitly confirmed the visible result. A missing event, unsupported model, error, or unconfirmed screen is a failure. The harness never calculates the Calculator answer, injects a click sequence, or turns a missing result into a pass.

The three goals are:

- `Open Notepad and type "Hello from OpenUse"`
- `Open Calculator and calculate 37 × 19.` — verify the visible Calculator result is `703`.
- `Open Notepad, type "OpenUse test file", and save it as openuse-test.txt on my Desktop.`

Use a disposable Windows profile or prepare the desktop manually so that an old `openuse-test.txt` does not create an unrelated overwrite prompt. The harness does not delete files or close arbitrary applications.

## Qualification evidence

Each run writes only to the gitignored directory:

```text
.openuse\qualification\run-<timestamp>\
  session.json
  events.jsonl
  results.json
  report.md
```

The event stream is redacted at the Electron main-process boundary. It contains safe metadata such as task/model identity, action count, tool, target identity, actual interaction method, retry count, stale recoveries, duration, permission decisions, native health, monitor/DPI data, and screenshot dimensions. It does not contain API keys, model messages, chain-of-thought, screenshot pixels, passwords, full typed values, or accessibility values in the persisted report.

Interaction method is recorded from the native response, not the model request:

- `accessibility-native`: a Windows UI Automation pattern or ValuePattern performed the action.
- `element-coordinate`: a semantic element was found but its bounds were used as the input fallback.
- `vision-coordinate`: a coordinate action followed a current screenshot observation.
- `coordinate-input`: a coordinate input was used without a screenshot-derived target.
- `keyboard-input`: bounded keyboard input was used.

`report.md` calculates the success rate for every scenario. The report is `QUALIFIED` only when preflight passed, all three scenarios are 3/3, and every guided reliability check is explicitly marked `PASS`; the multi-monitor check may instead be explicitly marked unavailable when the native self-test found exactly one monitor. Otherwise it remains `INCOMPLETE`.

## Guided reliability checks

`qualify:windows` records operator-confirmed checks for:

- Stop during an active task, no later native action, and immediate second-task recovery.
- Unknown-app permission: Allow Once, Always Allow, Deny, and cancellation while the prompt is open.
- 100% display scaling.
- 125% or 150% display scaling.
- A real vision-coordinate fallback only after semantic UI Automation cannot identify the target.
- A secondary-monitor task when more than one display is available.

Do not let the harness change display settings. Change scaling manually, repeat the requested check, and inspect the qualification panel's monitor count, physical bounds, screenshot dimensions, origin, and DPI. The native self-test uses DPI-aware window queries for per-monitor diagnostics, and window captures report the target window's DPI. If there is only one display, mark multi-monitor `SKIP`; the report records it as unavailable, not as a multi-monitor pass.

When qualification mode is active, the right-side panel exposes:

- Windows Controller status, PID, protocol, last heartbeat, and last action.
- Non-invasive native self-test result and monitor count.
- Last tool, action number, retry count, actual interaction method, target element ID, window bounds, screenshot dimensions/origin/DPI, and the bounded normalized UI element list.

The panel shows normalized data only. It does not expose the raw Windows accessibility tree.

## Stop and recovery procedure

During a real active task press **Stop task**. Verify that the model request is cancelled, no queued tool reaches the native sidecar, the sidecar remains reusable, the task becomes `Stopped`, and a new task can start immediately. Also repeat while a permission dialog is open. If the sidecar exits, the UI must report `NATIVE_ENGINE_OFFLINE`; do not restart the app and call the original task a pass.

## Checklist

```text
[ ] verify:windows passes
[ ] Gateway connection passes
[ ] Notepad 3/3
[ ] Calculator 3/3
[ ] Save As 3/3
[ ] Stop tested
[ ] Allow Once tested
[ ] Always Allow tested
[ ] Deny tested
[ ] 100% DPI tested
[ ] 125% or 150% DPI tested
[ ] vision fallback tested
[ ] multi-monitor tested or marked unavailable
```

No item in this checklist may be checked from a macOS cross-build. Complete it only from the evidence of an interactive Windows run.
