using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;

namespace OpenUse.WindowsController;

internal static class Program
{
    [STAThread]
    public static int Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        var controller = new WindowsComputerController();
        using var queue = new BlockingCollection<QueuedRequest>();
        var cancellations = new ConcurrentDictionary<string, CancellationTokenSource>(StringComparer.Ordinal);
        var worker = new Thread(() => ProcessQueue(queue, cancellations, controller))
        {
            IsBackground = false,
            Name = "OpenUse.WindowsController.STA",
        };
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();

        string? line;
        try
        {
            while ((line = Console.ReadLine()) is not null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                NativeRequest? request = null;
                try
                {
                    request = JsonSerializer.Deserialize<NativeRequest>(line, Protocol.JsonOptions);
                    if (request is null || string.IsNullOrWhiteSpace(request.Id) || string.IsNullOrWhiteSpace(request.Method))
                        throw new NativeControllerException("INVALID_TOOL_INPUT", "A request requires an id and method.");

                    if (request.Method.Equals("cancel", StringComparison.OrdinalIgnoreCase))
                    {
                        HandleCancellation(request, cancellations);
                        continue;
                    }

                    var cancellation = new CancellationTokenSource();
                    if (!cancellations.TryAdd(request.Id, cancellation))
                    {
                        cancellation.Dispose();
                        throw new NativeControllerException("INVALID_TOOL_INPUT", $"Request ID {request.Id} was already used.");
                    }

                    try
                    {
                        queue.Add(new QueuedRequest(request, cancellation));
                    }
                    catch (InvalidOperationException)
                    {
                        cancellations.TryRemove(request.Id, out _);
                        cancellation.Dispose();
                        throw new NativeControllerException("NATIVE_ENGINE_OFFLINE", "The Windows controller is shutting down.");
                    }
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
                    Protocol.Write(NativeResponse.Failure(request?.Id ?? "unknown", "IPC_ERROR", "The Windows controller failed to accept the request."));
                }
            }
        }
        finally
        {
            queue.CompleteAdding();
            worker.Join();
        }

        return 0;
    }

    private static void HandleCancellation(NativeRequest request, ConcurrentDictionary<string, CancellationTokenSource> cancellations)
    {
        try
        {
            var input = Protocol.ReadParams<CancelRequestParams>(request.Params);
            if (string.IsNullOrWhiteSpace(input.RequestId))
                throw new NativeControllerException("INVALID_TOOL_INPUT", "A cancel request requires a request ID.");
            var cancelled = cancellations.TryGetValue(input.RequestId, out var source);
            if (cancelled)
            {
                try { source!.Cancel(); }
                catch (ObjectDisposedException) { cancelled = false; }
            }
            Protocol.Write(NativeResponse.Success(request.Id, new { ok = true, cancelled }));
        }
        catch (NativeControllerException exception)
        {
            Protocol.Write(NativeResponse.Failure(request.Id, exception.Code, exception.Message));
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"OpenUse Windows controller cancellation error: {exception.GetType().Name}");
            Protocol.Write(NativeResponse.Failure(request.Id, "IPC_ERROR", "The Windows controller could not cancel the request."));
        }
    }

    private static void ProcessQueue(
        BlockingCollection<QueuedRequest> queue,
        ConcurrentDictionary<string, CancellationTokenSource> cancellations,
        WindowsComputerController controller)
    {
        foreach (var queued in queue.GetConsumingEnumerable())
        {
            var request = queued.Request;
            try
            {
                var result = controller.DispatchAsync(request.Method, request.Params, queued.Cancellation.Token).GetAwaiter().GetResult();
                Protocol.Write(NativeResponse.Success(request.Id, result));
            }
            catch (OperationCanceledException)
            {
                Protocol.Write(NativeResponse.Failure(request.Id, "TASK_CANCELLED", "The native action was cancelled."));
            }
            catch (NativeControllerException exception)
            {
                Protocol.Write(NativeResponse.Failure(request.Id, exception.Code, exception.Message));
            }
            catch (Exception exception)
            {
                // Never put exception details or user content on stdout. Stdout is the protocol.
                Console.Error.WriteLine($"OpenUse Windows controller error: {exception.GetType().Name}");
                Protocol.Write(NativeResponse.Failure(request.Id, "IPC_ERROR", "The Windows controller failed to complete the request."));
            }
            finally
            {
                if (cancellations.TryRemove(request.Id, out var cancellation)) cancellation.Dispose();
            }
        }
    }

    private sealed record QueuedRequest(NativeRequest Request, CancellationTokenSource Cancellation);
}
