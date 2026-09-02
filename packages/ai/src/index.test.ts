import { describe, expect, it } from "vitest";
import { GatewayModelProvider, getModelCapabilities, getModelDefinition, testGatewayConnection } from "./index";

describe("model capability registry", () => {
  it("marks the initial catalog as Computer Use compatible", () => {
    expect(getModelCapabilities("openai/gpt-5.4")).toMatchObject({
      toolCalling: true,
      vision: true,
    });
  });

  it("fails closed for an unknown model", () => {
    expect(getModelCapabilities("local/unknown")).toEqual({
      toolCalling: false,
      vision: false,
    });
    expect(getModelDefinition("local/unknown")).toBeUndefined();
  });

  it("does not make a model request without a configured key", async () => {
    const provider = new GatewayModelProvider(async () => undefined);

    await expect(provider.generateAgentStep({
      modelId: "openai/gpt-5.4",
      instructions: "test",
      messages: [{ role: "user", content: "test" }],
      tools: {},
      abortSignal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "MODEL_FAILED" });
  });

  it("rejects unsupported model metadata before contacting Gateway", async () => {
    const provider = new GatewayModelProvider(async () => "vca_test_key");

    await expect(provider.generateAgentStep({
      modelId: "local/unknown",
      instructions: "test",
      messages: [{ role: "user", content: "test" }],
      tools: {},
      abortSignal: new AbortController().signal,
    })).rejects.toMatchObject({ code: "MODEL_UNSUPPORTED" });
  });

  it("reports missing credentials without contacting Gateway", async () => {
    await expect(testGatewayConnection(async () => undefined, "openai/gpt-5.4")).resolves.toEqual({
      ok: false,
      code: "INVALID_API_KEY",
      message: "Add an AI Gateway API key before testing the connection.",
    });
  });

  it("checks capability metadata before attempting a connection", async () => {
    await expect(testGatewayConnection(async () => "vca_test_key", "local/unknown")).resolves.toMatchObject({
      ok: false,
      code: "MODEL_UNSUPPORTED",
    });
  });
});
