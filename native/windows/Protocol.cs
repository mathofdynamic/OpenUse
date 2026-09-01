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

public sealed record AppInfo(string Id, string Name, string ProcessName);

public sealed record WindowInfo(string Id, string Title, string App, string ProcessName, Bounds Bounds, bool Focused);

public sealed record UiElement(
    string Id,
    string Role,
    string Name,
    string? AutomationId,
    Bounds Bounds,
    bool Enabled,
    bool Offscreen);

public sealed record WindowInspection(WindowInfo Window, IReadOnlyList<UiElement> Elements, bool Truncated);

public sealed record Screenshot(string Data, string MimeType, int Width, int Height, string Source);

public sealed record OperationResult(bool Ok, bool Changed, WindowInfo? Window = null, string? Detail = null);

public sealed record InspectWindowParams(string WindowId);
public sealed record CaptureScreenParams(string? WindowId);
public sealed record LaunchAppParams(string App, string[]? Arguments);
public sealed record FocusWindowParams(string WindowId);
public sealed record ClickParams(int X, int Y, string? Button);
public sealed record ClickElementParams(string WindowId, string? ElementId, string? Role, string? Name, string? AutomationId);
public sealed record DoubleClickParams(int X, int Y);
public sealed record TypeTextParams(string Text, string? WindowId, string? ElementId, string? Role, string? Name);
public sealed record PressKeyParams(string Key);
public sealed record ScrollParams(int Amount, int? X, int? Y);
public sealed record WaitParams(int Milliseconds);

public static class Protocol
{
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
        catch (JsonException exception)
        {
            throw new NativeControllerException("INVALID_TOOL_INPUT", $"The request parameters were invalid: {exception.Message}");
        }
    }

    public static void Write(NativeResponse response)
    {
        Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions));
        Console.Out.Flush();
    }
}
