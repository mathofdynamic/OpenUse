# Windows Codex handoff prompt

Copy and paste the following prompt into Codex when OpenUse is opened on a Windows 10/11 x64 development machine:

```text
Continue OpenUse from the existing repository. This architecture is already built; do not redesign it or add unrelated features.

Repository: <PATH_TO_OPENUSE>

Run the Windows preflight first:

  pnpm setup:windows
  pnpm verify:windows

Do not claim readiness if either command fails. Inspect and fix actual Windows compiler, sidecar, UI Automation, process, IPC, DPI, permission, or cancellation failures. Do not fake GUI results, calculate Calculator in code, use a fixed click script, bypass OpenUse tools, or weaken its security boundaries. Do not add shell, PowerShell, arbitrary filesystem, credential, installer, remote-control, MCP, browser-extension, or unrelated product features.

Then configure a compatible Vercel AI Gateway model and key through OpenUse Settings. Use Test connection and record the exact model ID. The model must have both tool calling and vision capability; if it does not, stop the qualification run.

Run:

  pnpm qualify:windows

Use the harness's three goal definitions exactly as shown. Perform each scenario three times:

  1. Open Notepad and type "Hello from OpenUse".
  2. Open Calculator and calculate 37 × 19; verify the visible result is 703.
  3. Open Notepad, type "OpenUse test file", and save it as openuse-test.txt on the Desktop.

The AI must solve the goals incrementally through OpenUse's typed tools. Prefer fresh UI Automation element IDs and native patterns. Inspect again after a dialog/window change. Treat stale element IDs as recovery signals. Use screenshot/vision coordinates only when semantic UI Automation cannot locate the target. Confirm all consequential results from fresh UI state. Do not manually operate the target applications except for permission decisions.

Investigate and fix failures rather than documenting them as success. Inspect the normalized tree, AutomationId, ControlType, ClassName, enabled/offscreen state, supported patterns, window PID/identity, foreground window, and native response interactionMethod. Verify Save As sees the new foreground dialog. Verify screenshot dimensions and physical coordinate mapping at 100% and 125% or 150% DPI, and record monitorCount/multi-monitor behavior without changing settings automatically.

Also execute the guided Stop, permission, and vision-fallback checks. During Stop, ensure model cancellation, queued-action cancellation, sidecar reuse, and immediate second-task recovery. Ensure unknown-app Allow Once, Always Allow, Deny, and permission-dialog cancellation are real runtime decisions before native execution.

Qualification is accepted only when Notepad, Calculator, and Save As are each 3/3, the Gateway model is recorded, and the report's required reliability checks are explicitly passed or multi-monitor is explicitly unavailable. Preserve the redacted evidence under .openuse/qualification/; never commit screenshots or secrets. Do not report a pass without reading the generated results.json and report.md.

At the end, report the actual Windows version/build, Node/pnpm/.NET/Electron versions, native build/tests, sidecar self-test, live model ID, scenario attempts, action counts, UIA vs element-coordinate vs vision-coordinate counts, retries/stale recoveries, permission and cancellation evidence, DPI/monitor observations, remaining blockers, and focused commit hashes.
```
