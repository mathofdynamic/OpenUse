using System.Text.Json;

namespace OpenUse.WindowsController;

internal static class Program
{
    public static async Task<int> Main()
    {
        var controller = new WindowsComputerController();
        string? line;
        while ((line = Console.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            NativeRequest? request = null;
            try
            {
                request = JsonSerializer.Deserialize<NativeRequest>(line, Protocol.JsonOptions);
                if (request is null || string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.Method))
                    throw new NativeControllerException("INVALID_TOOL_INPUT", "A request requires an id and method.");

                var result = await controller.DispatchAsync(request.Method, request.Params);
                Protocol.Write(NativeResponse.Success(request.Id, result));
            }
            catch (NativeControllerException exception)
            {
                Protocol.Write(NativeResponse.Failure(request?.Id ?? "unknown", exception.Code, exception.Message));
            }
            catch (JsonException exception)
            {
                Protocol.Write(NativeResponse.Failure(request?.Id ?? "unknown", "INVALID_TOOL_INPUT", $"Invalid JSON request: {exception.Message}"));
            }
            catch (Exception exception)
            {
                // Never put exception details or user content on stdout. Stdout is the protocol.
                Console.Error.WriteLine($"OpenUse Windows controller error: {exception.GetType().Name}");
                Protocol.Write(NativeResponse.Failure(request?.Id ?? "unknown", "IPC_ERROR", "The Windows controller failed to complete the request."));
            }
        }

        return 0;
    }
}
