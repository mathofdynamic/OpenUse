import { createGateway, generateText, isStepCount } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { OpenUseError, type ModelCapabilities, type ModelDefinition } from "@openuse/shared";

export const MODEL_CATALOG: ModelDefinition[] = [
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
