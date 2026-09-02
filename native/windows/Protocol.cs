using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpenUse.WindowsController;

public sealed record NativeRequest(string Id, string Method, JsonElement Params);

public sealed record NativeError(string Code, string Message);

public sealed record NativeResponse(string Id, bool Ok, object? Result = null, NativeError? Error = null)
{
    public static NativeResponse Success(string id, object result) => new(id, true, result);
    public static NativeResponse Failure(string id, string code, string message) => new(id, false, null, new NativeError(code, message));
}

public sealed class NativeControllerException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed record Bounds(int X, int Y, int Width, int Height);

public sealed record AppInfo(string Id, string Name, string ProcessName, int ProcessId, string AppIdentity);

public sealed record WindowInfo(
    string Id,
    string Title,
    string App,
    string AppIdentity,
    string ProcessName,
    int ProcessId,
    string ClassName,
    Bounds Bounds,
    bool Focused);

public sealed record UiElement(
    string Id,
    string? ParentId,
    string Role,
    string Name,
    string? AutomationId,
    string ClassName,
    Bounds Bounds,
    bool Enabled,
    bool Offscreen,
    IReadOnlyList<string> SupportedPatterns,
    string? Value = null);

public sealed record WindowInspection(WindowInfo Window, IReadOnlyList<UiElement> Elements, bool Truncated);

public sealed record Screenshot(
    string Data,
    string MimeType,
    int Width,
    int Height,
    string Source,
    string CoordinateSystem,
    int Dpi,
    Bounds CaptureBounds);

public sealed record OperationResult(
    bool Ok,
    bool Changed,
    WindowInfo? Window = null,
    string? Detail = null,
    string? InteractionMethod = null,
    string? TargetElementId = null);

public sealed record MonitorInfo(int Index, Bounds Bounds, Bounds WorkArea, int Dpi, bool Primary);

public sealed record ScreenshotDiagnostics(int Width, int Height, int Dpi, string CoordinateSystem, Bounds CaptureBounds);

public sealed record SelfTestResult(
    bool Ok,
    bool UiAutomationAvailable,
    bool WindowEnumerationAvailable,
    bool ScreenEnumerationAvailable,
    bool ScreenshotAvailable,
    bool DpiAvailable,
    bool InputApisAvailable,
    int MonitorCount,
    IReadOnlyList<MonitorInfo> Monitors,
    ScreenshotDiagnostics? Screenshot = null,
    string? Detail = null);

public sealed record InspectWindowParams(string WindowId);
public sealed record CaptureScreenParams(string? WindowId);
public sealed record LaunchAppParams(string App, string[]? Arguments);
public sealed record FocusWindowParams(string WindowId);
public sealed record ClickParams(int? X, int? Y, string? Button);
public sealed record ClickElementParams(string WindowId, string? ElementId, string? Role, string? Name, string? AutomationId, string? ClassName);
public sealed record DoubleClickParams(int? X, int? Y);
public sealed record TypeTextParams(string Text, string? WindowId, string? ElementId, string? Role, string? Name, string? AutomationId, string? ClassName);
public sealed record PressKeyParams(string Key);
public sealed record ScrollParams(int? Amount, int? X, int? Y);
public sealed record WaitParams(int Milliseconds);
public sealed record CancelRequestParams(string RequestId);

public static class Protocol
{
    private static readonly object WriteLock = new();

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static T ReadParams<T>(JsonElement value)
    {
        try
        {
            return value.Deserialize<T>(JsonOptions)
                ?? throw new NativeControllerException("INVALID_TOOL_INPUT", "The request parameters were empty.");
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or NotSupportedException)
        {
            throw new NativeControllerException("INVALID_TOOL_INPUT", $"The request parameters were invalid: {exception.Message}");
        }
    }

    public static void Write(NativeResponse response)
    {
        lock (WriteLock)
        {
            Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
            Console.Out.Flush();
        }
    }
}
