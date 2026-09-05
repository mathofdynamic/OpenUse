import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, DEFAULT_REASONING_EFFORT, GatewayModelProvider, calculateModelCost, classifyGatewayConnectionError, customModelDefinition, estimateTwentyStepCost, extractGatewayCost, getCompatibilityIssues, getModelCapabilities, getModelDefinition, parseGatewayCatalog, resolveReasoningEffort, testGatewayConnection } from "./index";

describe("model capability registry", () => {
  it("marks the initial catalog as Computer Use compatible", () => {
    expect(DEFAULT_MODEL_ID).toBe("openai/gpt-5.6-luna");
    expect(getModelCapabilities(DEFAULT_MODEL_ID)).toMatchObject({
      toolCalling: true,
      vision: true,
    });
    expect(DEFAULT_REASONING_EFFORT).toBe("high");
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

  it("uses a Gateway-compatible output budget for the connection probe", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ error: { message: "test failure" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await testGatewayConnection(async () => "vca_test_key", "openai/gpt-5.4");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBody).toMatchObject({ maxOutputTokens: 32 });
  });

  it("does not mislabel a Gateway policy denial as an invalid key", async () => {
    const gatewayForbidden = { name: "GatewayForbiddenError", type: "forbidden", statusCode: 403, message: "The request was rejected by a routing rule." };

    expect(classifyGatewayConnectionError(gatewayForbidden)).toEqual({
      ok: false,
      code: "GATEWAY_ERROR",
      message: "The AI Gateway denied this request (HTTP 403) by policy or model access. The API key may still be valid.",
    });
  });

  it("prioritizes a 403 policy response over generic API-key wording", () => {
    const gatewayForbidden = Object.assign(new Error("The API key is not allowed by this routing policy."), { statusCode: 403 });

    expect(classifyGatewayConnectionError(gatewayForbidden)).toMatchObject({
      ok: false,
      code: "GATEWAY_ERROR",
    });
  });

  it("gives an actionable message for authentication failures", () => {
    const gatewayAuthentication = Object.assign(new Error("Invalid API key"), { statusCode: 401 });

    expect(classifyGatewayConnectionError(gatewayAuthentication)).toEqual({
      ok: false,
      code: "INVALID_API_KEY",
      message: "AI Gateway authentication failed (HTTP 401). Use a Vercel AI Gateway key from the AI Gateway API Keys page; OpenAI or Anthropic provider keys are not interchangeable.",
    });
  });

  it("parses dynamic Gateway metadata, capabilities, direct pricing, and tiers", () => {
    const models = parseGatewayCatalog({ data: [
      {
        id: "provider/agent-model",
        name: "Agent Model",
        owned_by: "provider",
        type: "language",
        context_window: 128000,
        tags: ["tool-use", "reasoning"],
        modalities: { input: ["text", "image"], output: ["text"] },
        supported_parameters: ["tools", "reasoning"],
        reasoning_options: [{ type: "toggle" }],
        pricing: { input: "0.000001", output: "0.000002" },
      },
      {
        id: "provider/image-model",
        type: "image",
        pricing: { input: "0.000001", output: "0.000002" },
      },
      {
        id: "provider/tiered",
        type: "language",
        tags: ["tool-use"],
        modalities: { input: ["image"], output: ["text"] },
        pricing: { input_tiers: [{ min: 0, max: 1000, cost: "0.000001" }, { min: 1000, cost: "0.000002" }], output: "0.000003" },
      },
    ] });
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: "provider/agent-model", contextWindow: 128000, capabilities: { toolCalling: true, vision: true, reasoning: true, reasoningEfforts: ["provider-default", "none"] }, pricing: { inputPerToken: 0.000001, outputPerToken: 0.000002 } });
    expect(models[1].pricing?.inputTiers).toHaveLength(2);
    expect(getCompatibilityIssues(models[1])).toEqual([]);
    expect(calculateModelCost(models[1].pricing, 1500, 1000)).toBeCloseTo(0.005, 12);
  });

  it("falls unsupported reasoning back to provider default and estimates twenty steps", () => {
    const model = parseGatewayCatalog({ data: [{ id: "provider/model", tags: ["tool-use", "reasoning"], modalities: { input: ["image"], output: ["text"] }, reasoning_options: [{ type: "toggle" }], pricing: { input: "0.000001", output: "0.000002" } }] })[0];
    expect(resolveReasoningEffort(model, "high")).toBe("provider-default");
    expect(resolveReasoningEffort(model, "none")).toBe("none");
    expect(estimateTwentyStepCost(model, { inputTokensPerStep: 1_000, outputTokensPerStep: 500, source: "general" })).toBeCloseTo(0.04, 12);
  });

  it("validates Gateway-reported request cost metadata", () => {
    expect(extractGatewayCost({ gateway: { cost: "0.0021" } })).toBe(0.0021);
    expect(extractGatewayCost({ gateway: { cost: -1 } })).toBeUndefined();
    expect(extractGatewayCost({ gateway: { cost: "not-a-number" } })).toBeUndefined();
  });

  it("keeps custom OpenAI-compatible configuration explicit", () => {
    expect(customModelDefinition({ baseUrl: "http://localhost:11434/v1", modelId: "llama3.2-vision", capabilities: { toolCalling: true, vision: true, reasoning: false } })).toMatchObject({
      provider: "custom-openai-compatible",
      sourceProvider: "Custom OpenAI-compatible endpoint",
      id: "llama3.2-vision",
      capabilities: { toolCalling: true, vision: true, reasoning: false },
    });
  });
});
