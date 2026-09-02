using System.Text.Json;
using OpenUse.WindowsController;
using Xunit;

namespace OpenUse.WindowsController.Tests;

public sealed class ProtocolTests
{
    [Fact]
    public void RequestParametersRoundTripWithCamelCase()
    {
        var json = JsonSerializer.Serialize(new { windowId = "42" }, Protocol.JsonOptions);
        using var document = JsonDocument.Parse(json);
        var parameters = Protocol.ReadParams<InspectWindowParams>(document.RootElement);
        Assert.Equal("42", parameters.WindowId);
    }

    [Fact]
    public void FailureResponseKeepsStructuredError()
    {
        var response = NativeResponse.Failure("r-1", "WINDOW_NOT_FOUND", "Window is gone.");
        var json = JsonSerializer.Serialize(response, Protocol.JsonOptions);
        Assert.Contains("WINDOW_NOT_FOUND", json, StringComparison.Ordinal);
        Assert.Contains("\"ok\":false", json, StringComparison.Ordinal);
    }

    [Fact]
    public void InvalidArgumentsAreReportedAsControllerInputErrors()
    {
        using var document = JsonDocument.Parse("{\"milliseconds\":\"slow\"}");

        var exception = Assert.Throws<NativeControllerException>(() => Protocol.ReadParams<WaitParams>(document.RootElement));

        Assert.Equal("INVALID_TOOL_INPUT", exception.Code);
    }

    [Fact]
    public async Task UnknownMethodIsRejected()
    {
        using var document = JsonDocument.Parse("{}");
        var controller = new WindowsComputerController();

        var exception = await Assert.ThrowsAsync<NativeControllerException>(() => controller.DispatchAsync("notARealMethod", document.RootElement));

        Assert.Equal("UNSUPPORTED_ACTION", exception.Code);
    }

    [Fact]
    public async Task InvalidWindowIdIsRejectedWithoutTouchingInputApis()
    {
        using var document = JsonDocument.Parse("{\"windowId\":\"0\"}");
        var controller = new WindowsComputerController();

        var exception = await Assert.ThrowsAsync<NativeControllerException>(() => controller.DispatchAsync("inspectWindow", document.RootElement));

        Assert.Equal("WINDOW_NOT_FOUND", exception.Code);
    }

    [Fact]
    public async Task WaitReturnsAStableStructuredResult()
    {
        using var document = JsonDocument.Parse("{\"milliseconds\":50}");
        var controller = new WindowsComputerController();

        var result = await controller.DispatchAsync("wait", document.RootElement);

        var json = JsonSerializer.Serialize(result, Protocol.JsonOptions);
        Assert.Contains("\"ok\":true", json, StringComparison.Ordinal);
        Assert.Contains("\"waitedMs\":50", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WaitCanBeCancelledWithoutChangingTheProtocolShape()
    {
        using var document = JsonDocument.Parse("{\"milliseconds\":1000}");
        using var cancellation = new CancellationTokenSource();
        var controller = new WindowsComputerController();
        var request = Task.Run(() => controller.DispatchAsync("wait", document.RootElement, cancellation.Token));

        await Task.Delay(50);
        cancellation.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(async () => await request);
    }

    [Fact]
    public async Task WindowEnumerationReturnsACollection()
    {
        using var document = JsonDocument.Parse("{}");
        var controller = new WindowsComputerController();

        var result = await controller.DispatchAsync("listWindows", document.RootElement);

        var json = JsonSerializer.Serialize(result, Protocol.JsonOptions);
        using var parsed = JsonDocument.Parse(json);
        Assert.Equal(JsonValueKind.Array, parsed.RootElement.GetProperty("windows").ValueKind);
    }
}
