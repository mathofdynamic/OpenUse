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
}
