import { createGateway, generateText, isStepCount } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { OpenUseError, type ModelCapabilities, type ModelDefinition } from "@openuse/shared";

export const DEFAULT_MODEL_ID = "openai/gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT = "high" as const;

export const MODEL_CATALOG: ModelDefinition[] = [
  {
    id: DEFAULT_MODEL_ID,
    label: "GPT-5.6 Luna · high reasoning",
    provider: "vercel-gateway",
    capabilities: { toolCalling: true, vision: true, reasoning: true },
  },
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    provider: "vercel-gateway",
    capabilities: { toolCalling: true, vision: true, reasoning: true },
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "vercel-gateway",
    capabilities: { toolCalling: true, vision: true, reasoning: true },
  },
  {
    id: "google/gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "vercel-gateway",
    capabilities: { toolCalling: true, vision: true, reasoning: true },
  },
];

export function getModelDefinition(modelId: string): ModelDefinition | undefined {
  return MODEL_CATALOG.find((model) => model.id === modelId);
}

export function getModelCapabilities(modelId: string): ModelCapabilities {
  return getModelDefinition(modelId)?.capabilities ?? { toolCalling: false, vision: false };
}

export interface AgentStepOptions {
  modelId: string;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  abortSignal: AbortSignal;
}

export interface AgentStepResult {
  responseMessages: ModelMessage[];
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  finishReason: string;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;
  getCapabilities(modelId: string): ModelCapabilities;
  generateAgentStep(options: AgentStepOptions): Promise<AgentStepResult>;
}

export type GatewayConnectionErrorCode = "INVALID_API_KEY" | "NETWORK_ERROR" | "MODEL_UNSUPPORTED" | "GATEWAY_ERROR";

export type GatewayConnectionResult =
  | { ok: true; modelId: string; message: string }
  | { ok: false; code: GatewayConnectionErrorCode; message: string };

export async function testGatewayConnection(
  readApiKey: () => Promise<string | undefined>,
  modelId: string,
  abortSignal?: AbortSignal,
): Promise<GatewayConnectionResult> {
  const model = getModelDefinition(modelId);
  if (!model || !model.capabilities.toolCalling || !model.capabilities.vision) {
    return { ok: false, code: "MODEL_UNSUPPORTED", message: "The selected model is not marked as supporting Computer Use tool calling and vision." };
  }
  const apiKey = await readApiKey();
  if (!apiKey) return { ok: false, code: "INVALID_API_KEY", message: "Add an AI Gateway API key before testing the connection." };

  try {
    const gateway = createGateway({ apiKey });
    await generateText({
      model: gateway(modelId),
      prompt: "Reply with the single word OK.",
      // Some Gateway-routed reasoning models reject very small output budgets
      // before generation begins. Keep this probe small, but above the
      // provider minimum so a valid key is not misreported as a connection
      // failure.
      maxOutputTokens: 32,
      maxRetries: 0,
      abortSignal,
    });
    return { ok: true, modelId, message: "The AI Gateway connection is working." };
  } catch (error) {
    return classifyGatewayConnectionError(error);
  }
}

export function classifyGatewayConnectionError(error: unknown): GatewayConnectionResult {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof record.statusCode === "number"
    ? record.statusCode
    : typeof record.status === "number"
      ? record.status
      : undefined;
  const gatewayType = typeof record.type === "string" ? record.type : undefined;
  const gatewayName = typeof record.name === "string" ? record.name : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const statusDetail = status ? ` (HTTP ${status})` : "";
  if (gatewayType === "model_not_found" || gatewayName === "GatewayModelNotFoundError" || status === 404 || /model.+(not found|unsupported|does not exist)|unknown model/.test(message)) {
    return { ok: false, code: "MODEL_UNSUPPORTED", message: `The selected model is not available through the AI Gateway${statusDetail}.` };
  }
  if (gatewayType === "authentication_error" || gatewayName === "GatewayAuthenticationError" || status === 401) {
    return { ok: false, code: "INVALID_API_KEY", message: `AI Gateway authentication failed${statusDetail}. Use a Vercel AI Gateway key from the AI Gateway API Keys page; OpenAI or Anthropic provider keys are not interchangeable.` };
  }
  if (gatewayType === "forbidden" || gatewayType === "access_denied" || gatewayName === "GatewayForbiddenError" || status === 403 || /forbidden|routing rule|policy|access denied/.test(message)) {
    return { ok: false, code: "GATEWAY_ERROR", message: `The AI Gateway denied this request${statusDetail} by policy or model access. The API key may still be valid.` };
  }
  if (/unauthorized|invalid.+(key|token)|api key/.test(message)) {
    return { ok: false, code: "INVALID_API_KEY", message: `AI Gateway authentication failed${statusDetail}. Use a Vercel AI Gateway key from the AI Gateway API Keys page; OpenAI or Anthropic provider keys are not interchangeable.` };
  }
  if (/enotfound|econnrefused|etimedout|econnreset|enetunreach|network|fetch failed|offline/.test(message)) {
    return { ok: false, code: "NETWORK_ERROR", message: "OpenUse could not reach the AI Gateway. Check the network connection." };
  }
  return { ok: false, code: "GATEWAY_ERROR", message: "The AI Gateway returned an error while testing the connection." };
}

export class GatewayModelProvider implements ModelProvider {
  readonly id = "vercel-gateway";
  readonly displayName = "Vercel AI Gateway";

  constructor(private readonly readApiKey: () => Promise<string | undefined>) {}

  getCapabilities(modelId: string): ModelCapabilities {
    return getModelCapabilities(modelId);
  }

  async generateAgentStep(options: AgentStepOptions): Promise<AgentStepResult> {
    const apiKey = await this.readApiKey();
    if (!apiKey) {
      throw new OpenUseError("MODEL_FAILED", "Add an AI Gateway API key in Settings before running a task.");
    }
    const model = getModelDefinition(options.modelId);
    if (!model || !model.capabilities.toolCalling || !model.capabilities.vision) {
      throw new OpenUseError(
        "MODEL_UNSUPPORTED",
        "The selected model does not advertise both tool calling and vision support.",
      );
    }

    try {
      const gateway = createGateway({ apiKey });
      const result = await generateText({
        model: gateway(options.modelId),
        instructions: options.instructions,
        messages: options.messages,
        tools: options.tools,
        reasoning: options.modelId === DEFAULT_MODEL_ID ? DEFAULT_REASONING_EFFORT : undefined,
        stopWhen: isStepCount(1),
        maxRetries: 1,
        abortSignal: options.abortSignal,
      });
      const responseMessages = await result.responseMessages;
      const toolCalls = await result.toolCalls;
      const usage = await result.usage;
      return {
        responseMessages,
        toolCalls: toolCalls.map((call) => ({
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
        })),
        finishReason: result.finishReason,
        text: result.text,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
      };
    } catch (error) {
      if (error instanceof OpenUseError) throw error;
      if (options.abortSignal.aborted) {
        throw new OpenUseError("TASK_CANCELLED", "The task was stopped.", error);
      }
      throw new OpenUseError("MODEL_FAILED", "The model request failed. Check the Gateway key and connection.", error);
    }
  }
}
