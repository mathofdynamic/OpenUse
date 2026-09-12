import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  COMPUTER_USE_INSTRUCTIONS,
  ComputerUseAgent,
} from "@openuse/agent";
import {
  OpenUseError,
  nowIso,
  type NamedProviderId,
  type NamedProviderSettings,
  type NamedProviderStatus,
  type ModelDefinition,
  type ProviderQuotaSnapshot,
  type ProviderQuotaWindow,
  type ReasoningEffort,
  type RuntimeEvent,
} from "@openuse/shared";
import { namedProviderModelDefinition } from "@openuse/ai";
import type { PersistedSettings } from "./settings-store";
import { OpenUseMcpBridge } from "./named-provider-mcp";

const STATUS_TIMEOUT_MS = 8_000;
const PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;

interface ProviderSpec {
  id: NamedProviderId;
  displayName: string;
  command: string;
  authArgs: string[];
  installCommand: string;
  loginCommand: string;
}

const PROVIDER_SPECS: Record<NamedProviderId, ProviderSpec> = {
  codex: {
    id: "codex",
    displayName: "Codex",
    command: "codex",
    authArgs: ["login", "status"],
    installCommand: "npm install -g @openai/codex",
    loginCommand: "codex login",
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    command: "claude",
    authArgs: ["auth", "status", "--json"],
    installCommand: "npm install -g @anthropic-ai/claude-code",
    loginCommand: "claude auth login",
  },
  opencode: {
    id: "opencode",
    displayName: "OpenCode",
    command: "opencode",
    authArgs: ["auth", "list"],
    installCommand: "npm install -g opencode-ai",
    loginCommand: "opencode auth login",
  },
};

const PROVIDER_ORDER: NamedProviderId[] = ["codex", "claude", "opencode"];

const codexReasoningEffortSchema = z.object({
  reasoningEffort: z.string().optional(),
  effort: z.string().optional(),
}).passthrough();

const codexModelSchema = z.object({
  model: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  supportedReasoningEfforts: z.array(z.union([z.string(), codexReasoningEffortSchema])).optional(),
  defaultReasoningEffort: z.string().optional(),
  inputModalities: z.array(z.string()).optional(),
  hidden: z.boolean().optional(),
  isDefault: z.boolean().optional(),
}).passthrough();

const codexModelListSchema = z.object({
  data: z.array(codexModelSchema).optional(),
  models: z.array(codexModelSchema).optional(),
  nextCursor: z.string().nullable().optional(),
}).passthrough();

const codexQuotaWindowSchema = z.object({
  usedPercent: z.number().optional(),
  windowDurationMins: z.number().optional(),
  resetsAt: z.number().optional(),
}).passthrough();

const codexRateLimitsSchema = z.object({
  rateLimits: z.object({
    primary: codexQuotaWindowSchema.optional(),
    secondary: codexQuotaWindowSchema.optional(),
  }).passthrough().optional(),
  planType: z.string().optional(),
}).passthrough();

const openCodeModelSchema = z.object({
  id: z.string().min(1).max(240).optional(),
  name: z.string().max(240).optional(),
  description: z.string().max(4_000).optional(),
  family: z.string().max(160).optional(),
  attachment: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  tool_call: z.boolean().optional(),
  toolCall: z.boolean().optional(),
  modalities: z.object({ input: z.array(z.string().max(80)).max(32).optional(), output: z.array(z.string().max(80)).max(32).optional() }).passthrough().optional(),
  capabilities: z.object({ tools: z.boolean().optional(), input: z.array(z.string().max(80)).max(32).optional(), output: z.array(z.string().max(80)).max(32).optional() }).passthrough().optional(),
  cost: z.unknown().optional(),
  limit: z.record(z.string(), z.unknown()).optional(),
  variants: z.unknown().optional(),
  status: z.string().max(40).optional(),
  release_date: z.union([z.number(), z.string()]).optional(),
  released: z.union([z.number(), z.string()]).optional(),
  time: z.object({ released: z.union([z.number(), z.string()]).optional() }).passthrough().optional(),
}).passthrough();

export interface NamedProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface NamedProviderTaskOptions {
  provider: NamedProviderId;
  settings: PersistedSettings;
  taskId: string;
  command: string;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  threadContext?: string;
  abortSignal: AbortSignal;
  agent: ComputerUseAgent;
  onEvent(event: RuntimeEvent): void;
}

export interface NamedProviderRunResult {
  summary: string;
  actionCount: number;
  usage?: NamedProviderUsage;
}

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  spawnError?: Error;
}

interface ResolvedCommand {
  executable: string;
  prefixArgs: string[];
  displayPath: string;
  version?: string;
}

export class NamedProviderManager {
  private readonly statuses = new Map<NamedProviderId, NamedProviderStatus>();

  constructor(private readonly readSettings: () => PersistedSettings) {
    for (const provider of PROVIDER_ORDER) {
      const spec = PROVIDER_SPECS[provider];
      this.statuses.set(provider, {
        id: provider,
        displayName: spec.displayName,
        state: "checking",
        detail: `Checking the local ${spec.displayName} runtime.`,
        models: [],
      });
    }
  }

  snapshot(): NamedProviderStatus[] {
    return PROVIDER_ORDER.map((provider) => {
      const status = this.statuses.get(provider)!;
      return { ...status, models: status.models.map((model) => ({ ...model, capabilities: { ...model.capabilities, reasoningEfforts: model.capabilities.reasoningEfforts ? [...model.capabilities.reasoningEfforts] : undefined } })) };
    });
  }

  modelDefinition(provider: NamedProviderId, configuredModelId = ""): ModelDefinition {
    const status = this.statuses.get(provider);
    const selected = configuredModelId
      ? status?.models.find((model) => model.id === configuredModelId)
      : status?.models.find((model) => model.isDefault) ?? status?.models[0];
    if (selected) return selected;
    if (configuredModelId && status?.models.length) return unlistedNamedProviderModelDefinition(provider, configuredModelId);
    return namedProviderModelDefinition(provider, configuredModelId);
  }

  async refresh(provider?: NamedProviderId): Promise<void> {
    if (provider) {
      this.statuses.set(provider, await this.probe(provider));
      return;
    }
    const results = await Promise.all(PROVIDER_ORDER.map(async (item) => [item, await this.probe(item)] as const));
    for (const [id, status] of results) this.statuses.set(id, status);
  }

  async run(options: NamedProviderTaskOptions): Promise<NamedProviderRunResult> {
    const configured = options.settings.namedProviders[options.provider];
    const resolved = await resolveProviderCommand(options.provider, configured);
    if (!resolved) throw new OpenUseError("MODEL_FAILED", `${PROVIDER_SPECS[options.provider].displayName} is not installed or could not be started. Install it and choose Check connection in Settings.`);

    const bridge = new OpenUseMcpBridge({
      taskId: options.taskId,
      command: options.command,
      modelId: options.modelId,
      maxActions: 30,
      abortSignal: options.abortSignal,
      agent: options.agent,
      onEvent: options.onEvent,
    });
    await bridge.start();
    const bridgeSnapshot = bridge.snapshot();
    const temporaryDirectory = await createTemporaryDirectory();
    let child: ChildProcessWithoutNullStreams | undefined;
    let usage: NamedProviderUsage | undefined;
    let settled = false;
    const prompt = providerPrompt(options.command, options.threadContext);
    try {
      const launch = await this.buildLaunch(options, bridgeSnapshot.url, bridgeSnapshot.bearerToken, resolved, temporaryDirectory, prompt);
      const spawnedChild = spawn(launch.command, launch.args, {
        cwd: tmpdir(),
        env: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child = spawnedChild;
      // The task prompt is passed as an argument. Closing stdin prevents
      // non-interactive CLIs such as `codex exec` from waiting for an
      // unintended second prompt block.
      spawnedChild.stdin.end();
      const lines = createInterface({ input: spawnedChild.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        const candidate = parseNamedProviderUsage(line);
        if (candidate) usage = mergeUsage(usage, candidate);
      });
      spawnedChild.stderr.on("data", () => undefined);
      const abort = () => {
        if (settled) return;
        void terminateChild(spawnedChild);
      };
      options.abortSignal.addEventListener("abort", abort, { once: true });
      const result = await waitForChild(spawnedChild, PROVIDER_TIMEOUT_MS);
      settled = true;
      options.abortSignal.removeEventListener("abort", abort);
      lines.close();
      if (options.abortSignal.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
      if (result.spawnError) throw new OpenUseError("MODEL_FAILED", `${PROVIDER_SPECS[options.provider].displayName} could not start. Check the executable path and local subscription login.`, result.spawnError);
      if (result.code !== 0) throw new OpenUseError("MODEL_FAILED", `${PROVIDER_SPECS[options.provider].displayName} stopped before completing the OpenUse task.`);
      if (!bridge.completedSummary) throw new OpenUseError("MODEL_FAILED", `${PROVIDER_SPECS[options.provider].displayName} finished without verifying the task through OpenUse tools.`);
      return { summary: bridge.completedSummary, actionCount: bridge.actionCount, usage };
    } finally {
      settled = true;
      if (child && child.exitCode === null) await terminateChild(child);
      await bridge.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  private async buildLaunch(
    options: NamedProviderTaskOptions,
    url: string,
    bearerToken: string,
    resolved: ResolvedCommand,
    temporaryDirectory: string,
    prompt: string,
  ): Promise<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> {
    const env: NodeJS.ProcessEnv = { ...process.env, OPENUSE_PROVIDER_TASK: "1" };
    if (options.provider === "codex") {
      env.OPENUSE_MCP_BEARER_TOKEN = bearerToken;
      const args = [
        "exec",
        "--json",
        "--ephemeral",
        "--ignore-user-config",
        "--skip-git-repo-check",
        // Codex otherwise requires a provider-level approval for every MCP
        // call. Its automatic-review mode only becomes safe here because the
        // provider's non-OpenUse tools are explicitly disabled below; the
        // OpenUse permission/risk engine remains authoritative for actions.
        "--approve-for-me",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.unified_exec=false",
        "-c",
        "features.unified_exec_tty=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.browser_use=false",
        "-c",
        "features.browser_use_external=false",
        "-c",
        "features.browser_use_full_cdp_access=false",
        "-c",
        "features.computer_use=false",
        "-c",
        "features.image_generation=false",
        "-c",
        "features.view_image=false",
        "-c",
        "features.sleep_tool=false",
        "-c",
        "features.skill_search=false",
        "-c",
        "features.plugins=false",
        "-c",
        "features.plugin_sharing=false",
        "-c",
        "features.remote_plugin=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        `mcp_servers.openuse.url=${JSON.stringify(url)}`,
        "-c",
        'mcp_servers.openuse.bearer_token_env_var="OPENUSE_MCP_BEARER_TOKEN"',
      ];
      appendCodexReasoning(args, options.reasoningEffort);
      if (options.modelId && options.modelId !== "default") args.push("--model", options.modelId);
      args.push(prompt);
      return { command: resolved.executable, args: [...resolved.prefixArgs, ...args], env };
    }
    if (options.provider === "claude") {
      const configPath = join(temporaryDirectory, "claude-mcp.json");
      await writeJsonFile(configPath, {
        mcpServers: {
          openuse: {
            type: "http",
            url,
            headers: { Authorization: `Bearer ${bearerToken}` },
          },
        },
      });
      const args = [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--mcp-config",
        configPath,
        "--tools",
        "",
        "--allowedTools",
        "mcp__openuse__*",
        "--permission-mode",
        "dontAsk",
        "--disable-slash-commands",
        "--no-chrome",
        "--system-prompt",
        COMPUTER_USE_INSTRUCTIONS,
      ];
      if (options.modelId && options.modelId !== "default") args.push("--model", options.modelId);
      appendClaudeReasoning(args, options.reasoningEffort);
      return { command: resolved.executable, args: [...resolved.prefixArgs, ...args], env };
    }
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      ...(options.modelId && options.modelId !== "default" ? { model: options.modelId } : {}),
      mcp: {
        openuse: {
          type: "remote",
          url,
          enabled: true,
          headers: { Authorization: `Bearer ${bearerToken}` },
          oauth: false,
        },
      },
      tools: { "*": false, "openuse_*": true },
      permission: { "*": "deny", "openuse_*": "allow" },
      snapshot: false,
      agent: {
        openuse: {
          description: "OpenUse guarded desktop control agent",
          mode: "primary",
          prompt: COMPUTER_USE_INSTRUCTIONS,
          tools: { "*": false, "openuse_*": true },
        },
      },
    });
    const args = ["--pure", "run", "--format", "json", "--agent", "openuse", ...(options.modelId && options.modelId !== "default" ? ["--model", options.modelId] : [])];
    appendOpenCodeReasoning(args, options.reasoningEffort);
    args.push(prompt);
    return {
      command: resolved.executable,
      args: [...resolved.prefixArgs, ...args],
      env,
    };
  }

  private async probe(provider: NamedProviderId): Promise<NamedProviderStatus> {
    const spec = PROVIDER_SPECS[provider];
    const configured = this.readSettings().namedProviders[provider];
    const resolved = await resolveProviderCommand(provider, configured);
    const checkedAt = nowIso();
    if (!resolved) {
      return { id: provider, displayName: spec.displayName, state: "not-installed", detail: `Install ${spec.displayName} and run ${spec.loginCommand} before using this subscription.`, checkedAt, models: [] };
    }
    const auth = await runCommand(resolved.executable, [...resolved.prefixArgs, ...spec.authArgs], STATUS_TIMEOUT_MS);
    const authenticated = parseNamedProviderAuthentication(provider, auth);
    const baseStatus: NamedProviderStatus = {
      id: provider,
      displayName: spec.displayName,
      state: authenticated ? "ready" : auth.spawnError ? "error" : "not-authenticated",
      ...(resolved.version ? { version: resolved.version } : {}),
      executablePath: resolved.displayPath,
      detail: authenticated ? `${spec.displayName} subscription is authenticated.` : `Run ${spec.loginCommand}, then check the connection again.`,
      checkedAt,
      models: [],
    };
    if (!authenticated) return baseStatus;

    try {
      const enrichment = provider === "codex"
        ? await readCodexSubscription(resolved)
        : provider === "opencode"
          ? await readOpenCodeModels(resolved, configured.modelId)
          : { models: fallbackNamedProviderModels(provider, configured.modelId) };
      return { ...baseStatus, models: enrichment.models, ...(enrichment.quota ? { quota: enrichment.quota } : {}) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The provider did not return a valid model or usage snapshot.";
      return {
        ...baseStatus,
        models: fallbackNamedProviderModels(provider, configured.modelId),
        quota: { source: "unavailable", observedAt: nowIso(), windows: [], unavailableReason: reason },
        detail: `${baseStatus.detail} Model and limit details are temporarily unavailable.`,
      };
    }
  }
}

interface ProviderEnrichment {
  models: ModelDefinition[];
  quota?: ProviderQuotaSnapshot;
}

interface CodexRpcEnvelope {
  id?: unknown;
  result?: unknown;
  error?: { message?: string };
}

export function parseCodexModels(value: unknown): ModelDefinition[] {
  const parsed = codexModelListSchema.safeParse(value);
  if (!parsed.success) return [];
  const records = parsed.data.data ?? parsed.data.models ?? [];
  return records
    .filter((record) => record.hidden !== true)
    .map((record) => {
      const efforts = normalizeReasoningEfforts(record.supportedReasoningEfforts);
      const modalities = record.inputModalities ?? [];
      const supportsReasoning = efforts.length > 1;
      return {
        id: record.model,
        label: record.displayName?.trim() || record.model,
        provider: "codex",
        sourceProvider: "OpenAI Codex",
        modelType: "language",
        description: record.description,
        isDefault: record.isDefault === true,
        capabilities: {
          toolCalling: true,
          vision: modalities.some((modality) => /image|vision/i.test(modality)),
          reasoning: supportsReasoning,
          reasoningEfforts: efforts,
        },
        modalities: { input: modalities, output: ["text"] },
      } satisfies ModelDefinition;
    });
}

export function parseCodexQuota(value: unknown, observedAt = nowIso()): ProviderQuotaSnapshot | undefined {
  const parsed = codexRateLimitsSchema.safeParse(value);
  if (!parsed.success || !parsed.data.rateLimits) return undefined;
  const windows: ProviderQuotaWindow[] = [];
  const addWindow = (id: "primary" | "secondary", label: string, value: z.infer<typeof codexQuotaWindowSchema> | undefined) => {
    if (!value || !Number.isFinite(value.usedPercent)) return;
    const usedPercent = Math.min(100, Math.max(0, value.usedPercent ?? 0));
    const resetsAt = typeof value.resetsAt === "number" && Number.isFinite(value.resetsAt)
      ? new Date((value.resetsAt > 10_000_000_000 ? value.resetsAt : value.resetsAt * 1000)).toISOString()
      : undefined;
    windows.push({ id, label, usedPercent, remainingPercent: 100 - usedPercent, windowDurationMins: value.windowDurationMins, resetsAt });
  };
  addWindow("primary", "5-hour", parsed.data.rateLimits.primary);
  addWindow("secondary", "Weekly", parsed.data.rateLimits.secondary);
  return windows.length > 0 ? { source: "codex-app-server", observedAt, ...(parsed.data.planType ? { plan: parsed.data.planType } : {}), windows } : undefined;
}

export function parseOpenCodeModels(stdout: string, configuredModelId = ""): ModelDefinition[] {
  const records = parseOpenCodeModelRecords(stdout);
  const models = records.map((record, index) => openCodeModelDefinition(record.id, record.metadata, configuredModelId ? record.id === configuredModelId : index === 0));
  if (configuredModelId && !models.some((model) => model.id === configuredModelId)) {
    models.unshift(openCodeModelDefinition(configuredModelId, undefined, true));
  }
  return models;
}

const OPEN_CODE_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:@+-]*$/i;
const OPEN_CODE_REASONING_EFFORTS: ReasoningEffort[] = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"];

type OpenCodeModelMetadata = z.infer<typeof openCodeModelSchema>;

interface OpenCodeModelRecord {
  id: string;
  metadata?: OpenCodeModelMetadata;
}

function parseOpenCodeModelRecords(stdout: string): OpenCodeModelRecord[] {
  const text = stripAnsi(stdout);
  const lines = text.split(/\r?\n/);
  const records: OpenCodeModelRecord[] = [];
  let offset = 0;
  for (const line of lines) {
    const id = line.trim();
    const lineEnd = offset + line.length;
    if (OPEN_CODE_MODEL_ID_PATTERN.test(id) && !records.some((record) => record.id === id)) {
      let metadata: OpenCodeModelMetadata | undefined;
      let metadataOffset = lineEnd;
      if (text.startsWith("\r\n", metadataOffset)) metadataOffset += 2;
      else if (text[metadataOffset] === "\n") metadataOffset += 1;
      while (metadataOffset < text.length && /\s/.test(text[metadataOffset] ?? "")) metadataOffset += 1;
      const parsed = parseJsonValueAt(text, metadataOffset);
      if (parsed && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
        const validated = openCodeModelSchema.safeParse(parsed.value);
        if (validated.success) metadata = validated.data;
      }
      records.push({ id, metadata });
    }
    offset = lineEnd + (text.startsWith("\r\n", lineEnd) ? 2 : text[lineEnd] === "\n" ? 1 : 0);
  }
  return records;
}

function stripAnsi(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27) {
      result += value[index];
      continue;
    }
    if (value[index + 1] !== "[") continue;
    index += 2;
    while (index < value.length) {
      const code = value.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) break;
      index += 1;
    }
  }
  return result;
}

function parseJsonValueAt(text: string, start: number): { value: unknown; end: number } | undefined {
  const opening = text[start];
  if (opening !== "{" && opening !== "[") return undefined;
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth !== 0) continue;
      try {
        return { value: JSON.parse(text.slice(start, index + 1)) as unknown, end: index + 1 };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function openCodeModelDefinition(id: string, metadata: OpenCodeModelMetadata | undefined, isDefault: boolean): ModelDefinition {
  const [source] = id.split("/", 1);
  const inputModalities = metadata?.modalities?.input ?? metadata?.capabilities?.input ?? [];
  const outputModalities = metadata?.modalities?.output ?? metadata?.capabilities?.output ?? ["text"];
  const reasoningEfforts = parseOpenCodeReasoningEfforts(metadata?.variants);
  const toolCalling = metadata?.tool_call === true || metadata?.toolCall === true || metadata?.capabilities?.tools === true;
  const vision = metadata?.attachment === true || inputModalities.some((modality) => /image|vision|video/i.test(modality));
  const label = metadata?.name?.trim() || id;
  const contextWindow = openCodeNumber(metadata?.limit?.context);
  const maxOutputTokens = openCodeNumber(metadata?.limit?.output);
  const releasedAt = openCodeTimestamp(metadata?.release_date ?? metadata?.released ?? metadata?.time?.released);
  return {
    id,
    label,
    provider: "opencode",
    sourceProvider: `OpenCode / ${source}`,
    modelType: "language",
    isDefault,
    description: metadata?.description?.trim() || (metadata ? "Model metadata reported by the authenticated OpenCode runtime." : "OpenCode did not return metadata for this exact model ID."),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(releasedAt === undefined ? {} : { releasedAt }),
    modalities: { input: inputModalities, output: outputModalities },
    capabilities: {
      toolCalling,
      vision,
      reasoning: reasoningEfforts.length > 1,
      reasoningEfforts,
    },
  } satisfies ModelDefinition;
}

function parseOpenCodeReasoningEfforts(value: unknown): ReasoningEffort[] {
  const values = new Set<ReasoningEffort>(["provider-default"]);
  const add = (candidate: unknown) => {
    if (typeof candidate !== "string") return;
    const normalized = candidate.trim().toLowerCase() as ReasoningEffort;
    if (OPEN_CODE_REASONING_EFFORTS.includes(normalized)) values.add(normalized);
  };
  if (Array.isArray(value)) {
    for (const item of value) add(item);
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) add(key);
  }
  return OPEN_CODE_REASONING_EFFORTS.filter((effort) => values.has(effort));
}

function openCodeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function openCodeTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  const number = openCodeNumber(value);
  if (number === undefined) return undefined;
  const date = new Date(number < 10_000_000_000 ? number * 1_000 : number);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeReasoningEfforts(values: Array<string | { reasoningEffort?: string; effort?: string }> | undefined): ReasoningEffort[] {
  const allowed = new Set<ReasoningEffort>(["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"]);
  const result: ReasoningEffort[] = ["provider-default"];
  for (const value of values ?? []) {
    const candidate = typeof value === "string" ? value : value.reasoningEffort ?? value.effort;
    if (!candidate) continue;
    const normalized = candidate.toLowerCase() as ReasoningEffort;
    if (allowed.has(normalized) && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

function fallbackNamedProviderModels(provider: NamedProviderId, configuredModelId: string): ModelDefinition[] {
  if (configuredModelId) return [namedProviderModelDefinition(provider, configuredModelId)];
  if (provider === "claude") {
    return [
      { ...namedProviderModelDefinition(provider, "sonnet"), id: "sonnet", label: "Claude Sonnet", isDefault: true },
      { ...namedProviderModelDefinition(provider, "opus"), id: "opus", label: "Claude Opus" },
      { ...namedProviderModelDefinition(provider, "haiku"), id: "haiku", label: "Claude Haiku" },
    ];
  }
  return [namedProviderModelDefinition(provider)];
}

function unlistedNamedProviderModelDefinition(provider: NamedProviderId, configuredModelId: string): ModelDefinition {
  const base = namedProviderModelDefinition(provider, configuredModelId);
  return {
    ...base,
    capabilities: { toolCalling: false, vision: false, reasoning: false, reasoningEfforts: ["provider-default"] },
    description: "This exact model ID was not reported by the provider. Choose a live model or refresh the subscription before running Computer Use.",
  };
}

async function readCodexSubscription(resolved: ResolvedCommand): Promise<ProviderEnrichment> {
  let child: ChildProcessWithoutNullStreams | undefined;
  let lines: ReadlineInterface | undefined;
  try {
    child = spawn(resolved.executable, [...resolved.prefixArgs, "app-server", "--stdio"], {
      cwd: tmpdir(),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stderr.on("data", () => undefined);
    lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    await sendCodexRpcRequest(child, lines, 1, "initialize", {
      clientInfo: { name: "openuse", title: "OpenUse", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

    const records: ModelDefinition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 16; page += 1) {
      const result = await sendCodexRpcRequest(child, lines, page + 2, "model/list", cursor ? { cursor } : {});
      const parsed = codexModelListSchema.safeParse(result);
      if (!parsed.success) break;
      records.push(...parseCodexModels(parsed.data));
      cursor = parsed.data.nextCursor ?? undefined;
      if (!cursor) break;
    }
    const quotaResult = await sendCodexRpcRequest(child, lines, 100, "account/rateLimits/read", {});
    return {
      models: records.length > 0 ? records : fallbackNamedProviderModels("codex", ""),
      quota: parseCodexQuota(quotaResult) ?? { source: "unavailable", observedAt: nowIso(), windows: [], unavailableReason: "Codex did not report subscription limits." },
    };
  } finally {
    lines?.close();
    if (child && child.exitCode === null) await terminateChild(child);
  }
}

async function readOpenCodeModels(resolved: ResolvedCommand, configuredModelId: string): Promise<ProviderEnrichment> {
  const verboseResult = await runCommand(resolved.executable, [...resolved.prefixArgs, "--pure", "models", "--verbose"], STATUS_TIMEOUT_MS);
  const result = !verboseResult.spawnError && verboseResult.code === 0
    ? verboseResult
    : await runCommand(resolved.executable, [...resolved.prefixArgs, "models"], STATUS_TIMEOUT_MS);
  if (result.spawnError || result.code !== 0) throw result.spawnError ?? new Error("OpenCode did not return its model list.");
  const models = parseOpenCodeModels(result.stdout, configuredModelId);
  return { models: models.length > 0 ? models : fallbackNamedProviderModels("opencode", configuredModelId) };
}

function sendCodexRpcRequest(child: ChildProcessWithoutNullStreams, lines: ReadlineInterface, id: number, method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      lines.off("line", onLine);
      child.off("error", onError);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onLine = (line: string) => {
      let parsed: CodexRpcEnvelope;
      try { parsed = JSON.parse(line) as CodexRpcEnvelope; } catch { return; }
      if (parsed.id !== id) return;
      if (parsed.error) finish(() => reject(new Error(parsed.error?.message ?? `Codex ${method} failed.`)));
      else finish(() => resolve(parsed.result));
    };
    const onError = (error: Error) => finish(() => reject(error));
    const timer = setTimeout(() => finish(() => reject(new Error(`Timed out waiting for Codex ${method}.`))), STATUS_TIMEOUT_MS);
    lines.on("line", onLine);
    child.once("error", onError);
    try {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(`Could not send Codex ${method}.`)));
    }
  });
}

export function providerDisplayName(provider: NamedProviderId): string {
  return PROVIDER_SPECS[provider].displayName;
}

export function providerSetupCommands(provider: NamedProviderId): { install: string; login: string } {
  return { install: PROVIDER_SPECS[provider].installCommand, login: PROVIDER_SPECS[provider].loginCommand };
}

async function resolveProviderCommand(provider: NamedProviderId, configured: NamedProviderSettings): Promise<ResolvedCommand | undefined> {
  const spec = PROVIDER_SPECS[provider];
  const candidates = await commandCandidates(provider, spec.command, configured.executablePath);
  for (const candidate of candidates) {
    const target = await resolveCommandTarget(provider, candidate);
    if (!target) continue;
    const result = await runCommand(target.executable, [...target.prefixArgs, "--version"], STATUS_TIMEOUT_MS);
    if (!result.spawnError && result.code === 0) return { ...target, version: extractNamedProviderVersion(provider, result.stdout) };
  }
  return undefined;
}

async function commandCandidates(provider: NamedProviderId, command: string, configuredPath: string): Promise<string[]> {
  const configured = configuredPath.trim();
  if (configured) {
    if (process.platform !== "win32" || configured.includes("\\") || configured.includes("/") || /\.(?:cmd|exe)$/i.test(configured)) return [configured];
    return [configured, `${configured}.cmd`, `${configured}.exe`];
  }
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const where = await runCommand("where.exe", [command], 2_000);
    for (const line of where.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      if (existsSync(line)) candidates.push(line);
    }
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;
    const programFiles = process.env.ProgramFiles;
    const userProfile = process.env.USERPROFILE;
    const globalNodeRoots = [
      appData ? join(appData, "npm") : undefined,
      localAppData ? join(localAppData, "npm") : undefined,
      programFiles ? join(programFiles, "nodejs") : undefined,
      process.execPath ? dirname(process.execPath) : undefined,
    ].filter((value): value is string => Boolean(value));
    const packageCandidates = provider === "opencode"
      ? globalNodeRoots.map((root) => join(root, "node_modules", "opencode-ai", "bin", "opencode.exe"))
      : provider === "codex"
        ? globalNodeRoots.map((root) => join(root, "node_modules", "@openai", "codex", "bin", "codex.js"))
        : globalNodeRoots.map((root) => join(root, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
    for (const candidate of [
      appData ? join(appData, "npm", `${command}.cmd`) : undefined,
      localAppData ? join(localAppData, "npm", `${command}.cmd`) : undefined,
      programFiles ? join(programFiles, "nodejs", `${command}.cmd`) : undefined,
      userProfile ? join(userProfile, ".local", "bin", `${command}.exe`) : undefined,
      ...packageCandidates,
      `${command}.cmd`,
      command,
    ]) {
      const isPath = candidate?.includes("\\") || candidate?.includes("/");
      if (candidate && (existsSync(candidate) || !isPath) && !candidates.includes(candidate)) candidates.push(candidate);
    }
  } else {
    candidates.push(command);
  }
  return candidates;
}

async function resolveCommandTarget(provider: NamedProviderId, candidate: string): Promise<Omit<ResolvedCommand, "version"> | undefined> {
  if (process.platform !== "win32") return { executable: candidate, prefixArgs: [], displayPath: candidate };
  const normalized = candidate.toLowerCase();
  if (normalized.endsWith(".js") && existsSync(candidate)) return { executable: await resolveNodeExecutable(dirname(candidate)), prefixArgs: [candidate], displayPath: candidate };
  if (!normalized.endsWith(".cmd")) return { executable: candidate, prefixArgs: [], displayPath: candidate };

  const directory = dirname(candidate);
  const packageRoot = (packageName: string) => join(directory, "node_modules", packageName);
  if (provider === "codex") {
    const script = join(packageRoot("@openai"), "codex", "bin", "codex.js");
    if (existsSync(script)) {
      return { executable: await resolveNodeExecutable(directory), prefixArgs: [script], displayPath: candidate };
    }
  }
  if (provider === "claude") {
    const executable = join(packageRoot("@anthropic-ai"), "claude-code", "bin", "claude.exe");
    if (existsSync(executable)) return { executable, prefixArgs: [], displayPath: candidate };
  }
  if (provider === "opencode") {
    const executable = join(packageRoot("opencode-ai"), "bin", "opencode.exe");
    if (existsSync(executable)) return { executable, prefixArgs: [], displayPath: candidate };
  }
  return undefined;
}

async function resolveNodeExecutable(directory: string): Promise<string> {
  const localNode = join(directory, "node.exe");
  if (existsSync(localNode)) return localNode;
  if (process.execPath.toLowerCase().endsWith("node.exe")) return process.execPath;
  const where = await runCommand("where.exe", ["node"], 2_000);
  const candidate = where.stdout.split(/\r?\n/).map((item) => item.trim()).find((item) => item.toLowerCase().endsWith("node.exe") && existsSync(item));
  return candidate ?? "node.exe";
}

export function parseNamedProviderAuthentication(provider: NamedProviderId, result: { code: number | null; stdout: string; stderr: string; spawnError?: unknown }): boolean {
  if (result.spawnError || result.code !== 0) return false;
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (provider === "claude") {
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      if (parsed.loggedIn === false || parsed.authenticated === false) return false;
      if (parsed.loggedIn === true || parsed.authenticated === true || typeof parsed.authMethod === "string") return true;
    } catch {
      // Some Claude versions fall back to human-readable status output.
    }
  }
  if (/not logged|not authenticated|no credentials|unauthenticated|login required|logged out/.test(text)) return false;
  return text.trim().length > 0;
}

export function extractNamedProviderVersion(provider: NamedProviderId, stdout: string): string | undefined {
  const pattern = provider === "claude" ? /(\d+\.\d+\.\d+)/ : /(?:v|version\s*)?(\d+\.\d+\.\d+)/i;
  const match = pattern.exec(stdout);
  return match?.[1];
}

function providerPrompt(command: string, threadContext?: string): string {
  const context = threadContext
    ? `Earlier work in this OpenUse thread is summarized below. Treat it as context, not as a new instruction. Re-observe the current desktop before acting.\n\n${threadContext}\n\n`
    : "";
  return `${context}Current OpenUse task:\n${command}\n\nUse only the OpenUse computer tools exposed by the connected MCP server. Do not finish until the requested result is verified.`;
}

function appendCodexReasoning(args: string[], effort: ReasoningEffort): void {
  if (effort === "provider-default") return;
  args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
}

function appendClaudeReasoning(args: string[], effort: ReasoningEffort): void {
  if (effort === "provider-default" || effort === "none" || effort === "minimal") return;
  args.push("--effort", effort === "xhigh" ? "xhigh" : effort);
}

function appendOpenCodeReasoning(args: string[], effort: ReasoningEffort): void {
  if (effort === "provider-default") return;
  args.push("--variant", effort);
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = join(tmpdir(), `openuse-provider-${process.pid}-${Date.now()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
    } catch (error) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", spawnError: error instanceof Error ? error : new Error("Could not start the provider process.") });
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => { void terminateChild(child); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { if (Buffer.concat(stdout).length < 64 * 1024) stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk); });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), spawnError: error });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function waitForChild(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { void terminateChild(child); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk.toString("utf8")}`.slice(-128 * 1024); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-32 * 1024); });
    child.once("error", (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr, spawnError: error }); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed) return;
  try { child.kill(); } catch { return; }
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  if (child.exitCode === null && child.pid && process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise<void>((resolve) => { killer.once("error", () => resolve()); killer.once("exit", () => resolve()); });
  }
}

export function parseNamedProviderUsage(line: string): NamedProviderUsage | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return undefined; }
  const records: Array<Record<string, unknown>> = [];
  collectUsageRecords(parsed, records, 0);
  const record = records.at(-1);
  if (!record) return undefined;
  const inputTokens = tokenValue(record.input_tokens ?? record.inputTokens ?? record.prompt_tokens ?? record.promptTokens);
  const outputTokens = tokenValue(record.output_tokens ?? record.outputTokens ?? record.completion_tokens ?? record.completionTokens);
  return inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens };
}

function collectUsageRecords(value: unknown, result: Array<Record<string, unknown>>, depth: number): void {
  if (depth > 5 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectUsageRecords(item, result, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["usage", "tokens", "tokenUsage"]) {
    const candidate = record[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) result.push(candidate as Record<string, unknown>);
  }
  for (const child of Object.values(record)) collectUsageRecords(child, result, depth + 1);
}

function tokenValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

function mergeUsage(current: NamedProviderUsage | undefined, next: NamedProviderUsage): NamedProviderUsage {
  return {
    inputTokens: next.inputTokens ?? current?.inputTokens,
    outputTokens: next.outputTokens ?? current?.outputTokens,
  };
}
