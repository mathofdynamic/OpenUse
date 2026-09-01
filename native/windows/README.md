# OpenUse Windows sidecar

This process targets `net8.0-windows` and must run inside the user's interactive Windows desktop session. It reads one JSON request per stdin line and writes one JSON response per stdout line. Diagnostics go to stderr; stdout is never used for logs.

The controller intentionally exposes no TCP listener, shell, PowerShell, arbitrary filesystem, or credential API. UI Automation is used for inspection and semantic element actions. `SendInput`, pointer APIs, and reduced PNG capture are fallbacks for interactions that do not expose a usable semantic pattern.

Build from a Windows machine with the .NET 8 SDK:

```bash
dotnet publish native/windows/OpenUse.WindowsController.csproj -c Release -r win-x64 --self-contained false -o native/windows/publish
```
