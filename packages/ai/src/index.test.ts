import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID, DEFAULT_REASONING_EFFORT, GatewayModelProvider, classifyGatewayConnectionError, getModelCapabilities, getModelDefinition, testGatewayConnection } from "./index";

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
});
