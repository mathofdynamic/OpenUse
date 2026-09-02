# OpenUse Windows sidecar

This process targets `net8.0-windows` and must run inside the user's interactive Windows desktop session. It reads one JSON request per stdin line and writes one JSON response per stdout line. Diagnostics go to stderr; stdout is never used for logs.

The controller intentionally exposes no TCP listener, shell, PowerShell, arbitrary filesystem, or credential API. UI Automation is used for inspection and semantic element actions. `SendInput`, pointer APIs, and reduced PNG capture are fallbacks for interactions that do not expose a usable semantic pattern.

The process keeps a reader thread separate from a dedicated STA worker so cancellation requests can be received while a bounded native action is in progress. Its JSON-lines stdout is protocol-only; diagnostics are sent to stderr. UI Automation runtime IDs are used as element IDs, and stale/disappeared elements return structured errors. Window records carry process/class identity and packaged-app identity when Windows exposes one.

The sidecar is PerMonitorV2 DPI-aware. UI Automation bounds, pointer coordinates, and captures use virtual-screen physical pixels. Captures report the DPI, reduced image dimensions, and original physical capture bounds so a vision fallback can map image coordinates deliberately. The desktop parent uses the internal `cancel` protocol method on stop; it does not expose that method to the model.

Build from a Windows machine with the .NET 8 SDK:

```bash
dotnet publish native/windows/OpenUse.WindowsController.csproj -c Release -r win-x64 --self-contained false -o native/windows/publish
```

The native unit/protocol tests live in `native/windows.tests` and are Windows-session tests where they enumerate windows. Run them with:

```bash
dotnet test native/windows.tests/OpenUse.WindowsController.Tests.csproj
```
