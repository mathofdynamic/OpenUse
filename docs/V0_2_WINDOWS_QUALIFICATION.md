# OpenUse v0.2 Windows qualification

## Scope

This record separates verified Windows build/packaging/native evidence from real model-backed GUI acceptance. The host for this pass was Windows 11 Pro x64, build `10.0.26200`, with Node.js `24.18.0`, .NET `8.0.421`, pnpm `10.14.0`, one detected monitor, and an installed renderer launched with a Windows `device-scale-factor` of `1.25`.

## Verified in this pass

| Check | Result | Evidence |
| --- | --- | --- |
| Host environment | PASS | Windows 11 Pro x64; native setup check |
| `pnpm setup:windows` | PASS | locked install and .NET publish |
| TypeScript lint | PASS | `pnpm lint` |
| Typecheck | PASS | `pnpm typecheck` |
| Unit tests | PASS | shared workspace tests |
| Electron build | PASS | main, preload, overlay preload, renderer |
| Native .NET build | PASS | `dotnet publish` win-x64 |
| Native .NET tests | PASS | 10 tests passed |
| Sidecar IPC/self-test | PASS | malformed input, unknown method, invalid window, wait, cancellation, reuse, shutdown; monitor count 1 |
| Windows installer | PASS | `dist/windows/OpenUse-Setup-0.2.0-x64.exe` |
| Installed launch | PASS | installed `OpenUse.exe` ran with title `OpenUse`, responsive main process, renderer process, and `--app-path=...\\resources\\app.asar` |
| Packaged controller | PASS | installed `resources/native/windows/OpenUse.WindowsController.exe` plus `.dll`, `.deps.json`, and `.runtimeconfig.json`; packaged sidecar smoke test passed |
| Installer integrity | RECORDED | SHA-256 `24EB50A0D72527D595CD9829A7579AB4C17C62203B3508D19BCBC88FC26EC765` |

## Real GUI qualification status

The current T3 Code session does not expose native Windows application controls. Its browser-only automation surface cannot launch and operate Notepad, Calculator, or Save As without violating the requirement for real GUI qualification. Therefore these are explicitly **NOT RUN**, not failures and not passes:

| Scenario / check | Result |
| --- | --- |
| Notepad typing | NOT RUN — native GUI automation unavailable in this session |
| Calculator | NOT RUN — native GUI automation unavailable in this session |
| Save As | NOT RUN — native GUI automation unavailable in this session |
| Stop during real task, twice | NOT RUN |
| Allow Once / Always Allow / Deny | NOT RUN |
| Permission-dialog cancellation | NOT RUN |
| 100% DPI task | NOT RUN |
| 125% or 150% DPI task | NOT RUN |
| Second Gateway provider/model | NOT RUN — requires live Gateway task session |
| Two reasoning levels in a real request | NOT RUN — requires live Gateway task session |
| Agent Cursor over native applications | NOT RUN — requires native GUI task session |
| Multi-monitor | NOT TESTED — single-monitor machine |

The implementation-level cursor tests cover 125% scaling, negative secondary-display origins, macOS global points, click-through configuration, and hide-on-stop behavior. They do not replace visual desktop evidence.

## How to complete the remaining run

On the interactive Windows machine, configure a real Gateway key and compatible model, then run:

```powershell
pnpm qualify:windows
```

Use the installed app for at least one task after `pnpm dist:windows`; do not manually operate target applications. Record the generated `.openuse\qualification\run-*\report.md` and update this document only from that evidence.

## Cost and privacy evidence

The source path for actual Gateway cost is validated `providerMetadata.gateway.cost`, not token arithmetic. The usage ledger and live task/lifetime UI are implemented and unit-tested, but this pass has no real Gateway task request to cite. No key, prompt, screenshot, password, accessibility tree, or chain-of-thought was written to the repository.
