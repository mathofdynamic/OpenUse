import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGateway, generateText, isStepCount } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { z } from "zod";
import {
  OpenUseError,
  type ModelCapabilities,
  type ModelDefinition,
  type ModelPricing,
  type NamedProviderId,
  type PricingTier,
  type ProviderId,
  type ReasoningEffort,
} from "@openuse/shared";

export const DEFAULT_MODEL_ID = "openai/gpt-5.6-luna";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "high";
export const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

const ALL_REASONING_EFFORTS: ReasoningEffort[] = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"];
const EFFORT_VALUES = new Set<ReasoningEffort>(ALL_REASONING_EFFORTS);

const bundledCapabilities: ModelCapabilities = {
  toolCalling: true,
  vision: true,
  reasoning: true,
  reasoningEfforts: [...ALL_REASONING_EFFORTS],
};

/** This is only a last-resort catalog. Runtime selection uses the Gateway cache. */
export const MODEL_CATALOG: ModelDefinition[] = [
  { id: DEFAULT_MODEL_ID, label: "GPT-5.6 Luna", provider: "vercel-gateway", sourceProvider: "openai", modelType: "language", capabilities: { ...bundledCapabilities } },
  { id: "openai/gpt-5.4", label: "GPT-5.4", provider: "vercel-gateway", sourceProvider: "openai", modelType: "language", capabilities: { ...bundledCapabilities } },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", provider: "vercel-gateway", sourceProvider: "anthropic", modelType: "language", capabilities: { ...bundledCapabilities } },
  { id: "google/gemini-3-flash", label: "Gemini 3 Flash", provider: "vercel-gateway", sourceProvider: "google", modelType: "language", capabilities: { ...bundledCapabilities } },
];

const gatewayModelSchema = z.object({
  id: z.string().min(1).max(240),
  name: z.string().max(240).optional(),
  description: z.string().max(4_000).optional(),
  owned_by: z.string().max(160).optional(),
  type: z.string().max(80).optional(),
  created: z.union([z.number(), z.string()]).optional(),
  released: z.union([z.number(), z.string()]).optional(),
  context_window: z.union([z.number(), z.string()]).optional(),
  max_tokens: z.union([z.number(), z.string()]).optional(),
  tags: z.array(z.string().max(100)).max(80).optional(),
  supported_parameters: z.array(z.string().max(100)).max(120).optional(),
  modalities: z.object({ input: z.array(z.string()).optional(), output: z.array(z.string()).optional() }).optional(),
  reasoning_options: z.array(z.unknown()).max(20).optional(),
  pricing: z.unknown().optional(),
}).passthrough();

const gatewayResponseSchema = z.object({
  object: z.string().optional(),
  data: z.array(gatewayModelSchema).max(10_000),
}).passthrough();

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  const number = finiteNumber(value);
  if (number === undefined) return undefined;
  const date = new Date(number < 10_000_000_000 ? number * 1_000 : number);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length <= 160) : [];
}

function parseTier(value: unknown): PricingTier | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const perToken = finiteNumber(record.cost ?? record.price ?? record.per_token ?? record.perToken);
  if (perToken === undefined) return undefined;
  const minTokens = finiteNumber(record.min ?? record.min_tokens ?? record.minTokens) ?? 0;
  const maxTokens = finiteNumber(record.max ?? record.max_tokens ?? record.maxTokens);
  return { minTokens, ...(maxTokens === undefined ? {} : { maxTokens }), perToken };
}

function parseTiers(value: unknown): PricingTier[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tiers = value.map(parseTier).filter((tier): tier is PricingTier => Boolean(tier)).sort((a, b) => a.minTokens - b.minTokens);
  return tiers.length > 0 ? tiers : undefined;
}

function parsePricing(value: unknown): ModelPricing | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const inputTiers = parseTiers(record.input_tiers ?? record.inputTiers);
  const outputTiers = parseTiers(record.output_tiers ?? record.outputTiers);
  const cacheReadTiers = parseTiers(record.input_cache_read_tiers ?? record.cache_read_tiers ?? record.cacheReadTiers);
  const cacheWriteTiers = parseTiers(record.output_cache_write_tiers ?? record.cache_write_tiers ?? record.cacheWriteTiers);
  const inputPerToken = finiteNumber(record.input ?? record.input_per_token ?? record.inputPerToken);
  const outputPerToken = finiteNumber(record.output ?? record.output_per_token ?? record.outputPerToken);
  const cacheReadPerToken = finiteNumber(record.input_cache_read ?? record.cache_read ?? record.cacheRead ?? record.cacheReadPerToken);
  const cacheWritePerToken = finiteNumber(record.output_cache_write ?? record.cache_write ?? record.cacheWrite ?? record.cacheWritePerToken);
  if (!inputTiers && !outputTiers && !cacheReadTiers && !cacheWriteTiers && inputPerToken === undefined && outputPerToken === undefined && cacheReadPerToken === undefined && cacheWritePerToken === undefined) return undefined;
  return {
    ...(inputPerToken === undefined ? {} : { inputPerToken }),
    ...(outputPerToken === undefined ? {} : { outputPerToken }),
    ...(cacheReadPerToken === undefined ? {} : { cacheReadPerToken }),
    ...(cacheWritePerToken === undefined ? {} : { cacheWritePerToken }),
    ...(inputTiers ? { inputTiers } : {}),
    ...(outputTiers ? { outputTiers } : {}),
    ...(cacheReadTiers ? { cacheReadTiers } : {}),
    ...(cacheWriteTiers ? { cacheWriteTiers } : {}),
  };
}

function parseReasoningEfforts(raw: unknown, supportsReasoning: boolean): ReasoningEffort[] | undefined {
  if (!supportsReasoning) return undefined;
  const values = new Set<ReasoningEffort>(["provider-default"]);
  if (Array.isArray(raw)) {
    for (const option of raw) {
      if (!option || typeof option !== "object") continue;
      const record = option as Record<string, unknown>;
      if (record.type === "toggle") values.add("none");
      for (const value of stringArray(record.values)) {
        const normalized = value.toLowerCase() as ReasoningEffort;
        if (EFFORT_VALUES.has(normalized)) values.add(normalized);
      }
    }
  }
  return ALL_REASONING_EFFORTS.filter((effort) => values.has(effort));
}

export function parseGatewayCatalog(payload: unknown): ModelDefinition[] {
  const parsed = gatewayResponseSchema.parse(payload);
  return parsed.data.map((entry) => {
    const tags = stringArray(entry.tags);
    const supportedParameters = stringArray(entry.supported_parameters);
    const inputModalities = stringArray(entry.modalities?.input);
    const outputModalities = stringArray(entry.modalities?.output);
    const toolCalling = tags.includes("tool-use") || tags.includes("tools") || supportedParameters.includes("tools") || supportedParameters.includes("tool_choice");
    const vision = tags.includes("vision") || inputModalities.includes("image") || inputModalities.includes("video");
    const supportsReasoning = tags.includes("reasoning") || Array.isArray(entry.reasoning_options) || supportedParameters.includes("reasoning");
    return {
      id: entry.id,
      label: entry.name?.trim() || entry.id,
      provider: "vercel-gateway" as const,
      sourceProvider: entry.owned_by,
      modelType: entry.type,
      description: entry.description,
      contextWindow: finiteNumber(entry.context_window),
      maxOutputTokens: finiteNumber(entry.max_tokens),
      createdAt: timestamp(entry.created),
      releasedAt: timestamp(entry.released),
      tags,
      modalities: { input: inputModalities, output: outputModalities },
      capabilities: {
        toolCalling,
        vision,
        ...(supportsReasoning ? { reasoning: true, reasoningEfforts: parseReasoningEfforts(entry.reasoning_options, true) } : {}),
      },
      pricing: parsePricing(entry.pricing),
    } satisfies ModelDefinition;
  }).filter((model) => model.modelType === undefined || model.modelType === "language");
}

export function getModelDefinition(modelId: string, catalog: ModelDefinition[] = MODEL_CATALOG): ModelDefinition | undefined {
  return catalog.find((model) => model.id === modelId);
}

export function getModelCapabilities(modelId: string, catalog: ModelDefinition[] = MODEL_CATALOG): ModelCapabilities {
  return getModelDefinition(modelId, catalog)?.capabilities ?? { toolCalling: false, vision: false };
}

export function getCompatibilityIssues(model: ModelDefinition | undefined): string[] {
  if (!model) return ["This model is not present in the current catalog."];
  const issues: string[] = [];
  if (model.modelType && model.modelType !== "language") issues.push("It is not a language model.");
  if (!model.capabilities.toolCalling) issues.push("It does not advertise tool calling.");
  if (!model.capabilities.vision) issues.push("It does not advertise visual input.");
  return issues;
}

export function resolveReasoningEffort(model: ModelDefinition | undefined, requested: ReasoningEffort | undefined): ReasoningEffort | undefined {
  if (!model?.capabilities.reasoning) return undefined;
  if (!requested || requested === "provider-default") return "provider-default";
  return model.capabilities.reasoningEfforts?.includes(requested) ? requested : "provider-default";
}

export function priceForTokens(tokens: number, directPrice: number | undefined, tiers: PricingTier[] | undefined): number | undefined {
  if (!Number.isFinite(tokens) || tokens < 0) return undefined;
  if (!tiers?.length) return directPrice === undefined ? undefined : tokens * directPrice;
  let cost = 0;
  let covered = 0;
  for (const tier of tiers) {
    const lower = Math.max(0, tier.minTokens);
    const upper = tier.maxTokens === undefined ? tokens : Math.max(lower, tier.maxTokens);
    const amount = Math.max(0, Math.min(tokens, upper) - lower);
    if (amount > 0) {
      cost += amount * tier.perToken;
      covered += amount;
    }
  }
  if (covered < tokens && directPrice !== undefined) cost += (tokens - covered) * directPrice;
  return covered > 0 || tokens === 0 ? cost : undefined;
}

export function calculateModelCost(
  pricing: ModelPricing | undefined,
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number | undefined {
  if (!pricing) return undefined;
  const parts = [
    priceForTokens(inputTokens, pricing.inputPerToken, pricing.inputTiers),
    priceForTokens(outputTokens, pricing.outputPerToken, pricing.outputTiers),
    cacheReadTokens > 0 ? priceForTokens(cacheReadTokens, pricing.cacheReadPerToken, pricing.cacheReadTiers) : 0,
    cacheWriteTokens > 0 ? priceForTokens(cacheWriteTokens, pricing.cacheWritePerToken, pricing.cacheWriteTiers) : 0,
  ];
  if (parts.some((part) => part === undefined)) return undefined;
  return parts.reduce<number>((sum, part) => sum + (part ?? 0), 0);
}

export function formatPricePerMillion(price: number | undefined): string {
  if (price === undefined || !Number.isFinite(price)) return "Pricing unavailable";
  return `$${(price * 1_000_000).toFixed(price * 1_000_000 >= 1 ? 2 : 4)} / 1M`;
}

export interface UsageProfile {
  inputTokensPerStep: number;
  outputTokensPerStep: number;
  source: "model" | "general";
}

export function estimateTwentyStepCost(model: ModelDefinition | undefined, profile: UsageProfile | undefined, steps = 20): number | undefined {
  if (!model || !profile || steps <= 0) return undefined;
  return calculateModelCost(model.pricing, profile.inputTokensPerStep * steps, profile.outputTokensPerStep * steps);
}

const namedProviderInfo: Record<NamedProviderId, { label: string; sourceProvider: string; reasoningEfforts?: ReasoningEffort[] }> = {
  codex: { label: "Codex subscription", sourceProvider: "OpenAI Codex", reasoningEfforts: ["provider-default", "low", "medium", "high", "xhigh"] },
  claude: { label: "Claude subscription", sourceProvider: "Anthropic Claude Code", reasoningEfforts: ["provider-default", "low", "medium", "high", "xhigh"] },
  opencode: { label: "OpenCode subscription", sourceProvider: "OpenCode", reasoningEfforts: ["provider-default"] },
};

export function namedProviderModelDefinition(provider: NamedProviderId, configuredModelId = ""): ModelDefinition {
  const info = namedProviderInfo[provider];
  return {
    id: configuredModelId || `${provider}:default`,
    label: configuredModelId || info.label,
    provider,
    sourceProvider: info.sourceProvider,
    modelType: "language",
    description: "Authenticated through the provider's local subscription runtime. OpenUse exposes only its guarded computer tools.",
    capabilities: {
      toolCalling: true,
      vision: true,
      reasoning: true,
      reasoningEfforts: info.reasoningEfforts,
    },
  };
}

export interface AgentStepOptions {
  modelId: string;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  abortSignal: AbortSignal;
  reasoningEffort?: ReasoningEffort;
}

export interface AgentStepResult {
  responseMessages: ModelMessage[];
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  finishReason: string;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  actualCost?: number;
  costSource?: "gateway" | "estimated" | "unknown";
}

export interface ModelProvider {
  readonly id: string;
  readonly displayName: string;
  readonly providerId?: ProviderId;
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
  catalog: ModelDefinition[] = MODEL_CATALOG,
): Promise<GatewayConnectionResult> {
  const model = getModelDefinition(modelId, catalog);
  if (!model || !model.capabilities.toolCalling || !model.capabilities.vision) {
    return { ok: false, code: "MODEL_UNSUPPORTED", message: "The selected model is not marked as supporting Computer Use tool calling and vision." };
  }
  const apiKey = await readApiKey();
  if (!apiKey) return { ok: false, code: "INVALID_API_KEY", message: "Add an AI Gateway API key before testing the connection." };

  try {
    const gateway = createGateway({ apiKey });
    await generateText({ model: gateway(modelId), prompt: "Reply with the single word OK.", maxOutputTokens: 32, maxRetries: 0, abortSignal });
    return { ok: true, modelId, message: "The AI Gateway connection is working." };
  } catch (error) {
    return classifyGatewayConnectionError(error);
  }
}

export function classifyGatewayConnectionError(error: unknown): GatewayConnectionResult {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = typeof record.statusCode === "number" ? record.statusCode : typeof record.status === "number" ? record.status : undefined;
  const gatewayType = typeof record.type === "string" ? record.type : undefined;
  const gatewayName = typeof record.name === "string" ? record.name : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const statusDetail = status ? ` (HTTP ${status})` : "";
  if (gatewayType === "model_not_found" || gatewayName === "GatewayModelNotFoundError" || status === 404 || /model.+(not found|unsupported|does not exist)|unknown model/.test(message)) return { ok: false, code: "MODEL_UNSUPPORTED", message: `The selected model is not available through the AI Gateway${statusDetail}.` };
  if (gatewayType === "authentication_error" || gatewayName === "GatewayAuthenticationError" || status === 401) return { ok: false, code: "INVALID_API_KEY", message: `AI Gateway authentication failed${statusDetail}. Use a Vercel AI Gateway key from the AI Gateway API Keys page; OpenAI or Anthropic provider keys are not interchangeable.` };
  if (gatewayType === "forbidden" || gatewayType === "access_denied" || gatewayName === "GatewayForbiddenError" || status === 403 || /forbidden|routing rule|policy|access denied/.test(message)) return { ok: false, code: "GATEWAY_ERROR", message: `The AI Gateway denied this request${statusDetail} by policy or model access. The API key may still be valid.` };
  if (/unauthorized|invalid.+(key|token)|api key/.test(message)) return { ok: false, code: "INVALID_API_KEY", message: `AI Gateway authentication failed${statusDetail}. Use a Vercel AI Gateway key from the AI Gateway API Keys page; OpenAI or Anthropic provider keys are not interchangeable.` };
  if (/enotfound|econnrefused|etimedout|econnreset|enetunreach|network|fetch failed|offline/.test(message)) return { ok: false, code: "NETWORK_ERROR", message: "OpenUse could not reach the AI Gateway. Check the network connection." };
  return { ok: false, code: "GATEWAY_ERROR", message: "The AI Gateway returned an error while testing the connection." };
}

const gatewayMetadataSchema = z.object({ gateway: z.object({ cost: z.union([z.number(), z.string()]).optional() }).passthrough().optional() }).passthrough();

export function extractGatewayCost(metadata: unknown): number | undefined {
  const parsed = gatewayMetadataSchema.safeParse(metadata);
  if (!parsed.success) return undefined;
  const cost = finiteNumber(parsed.data.gateway?.cost);
  return cost;
}

export class GatewayModelProvider implements ModelProvider {
  readonly id = "vercel-gateway";
  readonly providerId = "vercel-gateway" as const;
  readonly displayName = "Vercel AI Gateway";

  constructor(private readonly readApiKey: () => Promise<string | undefined>, private readonly catalog: ModelDefinition[] = MODEL_CATALOG) {}

  getCapabilities(modelId: string): ModelCapabilities { return getModelCapabilities(modelId, this.catalog); }

  async generateAgentStep(options: AgentStepOptions): Promise<AgentStepResult> {
    const apiKey = await this.readApiKey();
    if (!apiKey) throw new OpenUseError("MODEL_FAILED", "Add an AI Gateway API key in Settings before running a task.");
    const model = getModelDefinition(options.modelId, this.catalog);
    if (!model || !model.capabilities.toolCalling || !model.capabilities.vision) throw new OpenUseError("MODEL_UNSUPPORTED", "The selected model does not advertise both tool calling and vision support.");
    try {
      const gateway = createGateway({ apiKey });
      const reasoning = resolveReasoningEffort(model, options.reasoningEffort);
      if (process.env.OPENUSE_DEBUG_AI_REQUESTS === "1") {
        console.debug(`[openuse] ${JSON.stringify({ type: "model.request", modelId: options.modelId, provider: this.providerId, reasoningEffort: reasoning ?? "provider-default" })}`);
      }
      const result = await generateText({
        model: gateway(options.modelId),
        instructions: options.instructions,
        messages: options.messages,
        tools: options.tools,
        ...(reasoning ? { reasoning } : {}),
        stopWhen: isStepCount(1),
        maxRetries: 1,
        abortSignal: options.abortSignal,
      });
      const usage = await result.usage;
      const actualCost = extractGatewayCost(result.providerMetadata);
      return {
        responseMessages: await result.responseMessages,
        toolCalls: (await result.toolCalls).map((call) => ({ toolCallId: call.toolCallId, toolName: call.toolName, input: call.input })),
        finishReason: result.finishReason,
        text: result.text,
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? undefined, cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? undefined },
        actualCost,
        costSource: actualCost === undefined ? "unknown" : "gateway",
      };
    } catch (error) {
      if (error instanceof OpenUseError) throw error;
      if (options.abortSignal.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.", error);
      throw new OpenUseError("MODEL_FAILED", "The model request failed. Check the Gateway key and connection.", error);
    }
  }
}

export interface CustomOpenAICompatibleOptions {
  readApiKey: () => Promise<string | undefined>;
  baseUrl: string;
  modelId: string;
  capabilities: ModelCapabilities;
}

export function customModelDefinition(options: Omit<CustomOpenAICompatibleOptions, "readApiKey">): ModelDefinition {
  return { id: options.modelId, label: options.modelId || "Custom model", provider: "custom-openai-compatible", sourceProvider: "Custom OpenAI-compatible endpoint", modelType: "language", capabilities: options.capabilities };
}

export class CustomOpenAICompatibleProvider implements ModelProvider {
  readonly id = "custom-openai-compatible";
  readonly providerId = "custom-openai-compatible" as const;
  readonly displayName = "Custom OpenAI-compatible endpoint";

  constructor(private readonly options: CustomOpenAICompatibleOptions) {}

  getCapabilities(_modelId: string): ModelCapabilities { return this.options.capabilities; }

  async generateAgentStep(options: AgentStepOptions): Promise<AgentStepResult> {
    if (!this.options.baseUrl || !this.options.modelId) throw new OpenUseError("MODEL_FAILED", "Configure a custom endpoint URL and model ID before running a task.");
    try {
      const apiKey = await this.options.readApiKey();
      const provider = createOpenAICompatible({ name: "openuse-custom", baseURL: this.options.baseUrl, ...(apiKey ? { apiKey } : {}), includeUsage: true });
      const reasoning = this.options.capabilities.reasoning ? options.reasoningEffort : undefined;
      if (process.env.OPENUSE_DEBUG_AI_REQUESTS === "1") {
        console.debug(`[openuse] ${JSON.stringify({ type: "model.request", modelId: options.modelId, provider: this.providerId, reasoningEffort: reasoning ?? "provider-default" })}`);
      }
      const result = await generateText({
        model: provider(this.options.modelId),
        instructions: options.instructions,
        messages: options.messages,
        tools: options.tools,
        ...(reasoning ? { reasoning } : {}),
        stopWhen: isStepCount(1),
        maxRetries: 1,
        abortSignal: options.abortSignal,
      });
      const usage = await result.usage;
      return {
        responseMessages: await result.responseMessages,
        toolCalls: (await result.toolCalls).map((call) => ({ toolCallId: call.toolCallId, toolName: call.toolName, input: call.input })),
        finishReason: result.finishReason,
        text: result.text,
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? undefined, cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? undefined },
        costSource: "unknown",
      };
    } catch (error) {
      if (error instanceof OpenUseError) throw error;
      if (options.abortSignal.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.", error);
      throw new OpenUseError("MODEL_FAILED", "The custom model request failed. Check the endpoint and model configuration.", error);
    }
  }
}
