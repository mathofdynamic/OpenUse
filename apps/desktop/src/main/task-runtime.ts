import { randomUUID } from "node:crypto";
import { ComputerUseAgent } from "@openuse/agent";
import { CustomOpenAICompatibleProvider, GatewayModelProvider, customModelDefinition, getModelDefinition, namedProviderModelDefinition, resolveReasoningEffort } from "@openuse/ai";
import { NativeComputerController } from "@openuse/computer";
import {
  InMemoryPermissionStore,
  PermissionEngine,
  type PermissionPrompt,
  type PermissionStore,
} from "@openuse/permissions";
import {
  OpenUseError,
  asOpenUseError,
  nowIso,
  type AppSettings,
  type ModelDefinition,
  type OpenUseErrorCode,
  type PermissionDecision,
  type PermissionRequest,
  type PermissionRecord,
  type PermissionLevel,
  type ProviderId,
  type RuntimeEvent,
} from "@openuse/shared";
import type { SettingsStore } from "./settings-store";
import type { NativeEngineProcess } from "./native-process";
import type { UsageStore } from "./usage-store";
import type { ThreadStore } from "./thread-store";
import type { NamedProviderManager } from "./named-provider-runtime";

export interface TaskRuntimeOptions {
  settings: SettingsStore;
  engine: NativeEngineProcess;
  readApiKey: () => Promise<string | undefined>;
  readCustomApiKey: () => Promise<string | undefined>;
  getModels: () => ModelDefinition[];
  usage: UsageStore;
  emit: (event: RuntimeEvent) => void;
  threads?: ThreadStore;
  namedProviders: NamedProviderManager;
  qualificationMode?: boolean;
}

interface ActiveTask {
  taskId: string;
  abort: AbortController;
  promise: Promise<void>;
}

interface PendingPermission {
  taskId: string;
  resolve(decision: PermissionDecision): void;
  reject(error: unknown): void;
}

class PersistentPermissionStore implements PermissionStore {
  private readonly memory: InMemoryPermissionStore;

  constructor(records: PermissionRecord[], private readonly persist: (appName: string, level: PermissionLevel, appIdentity?: string) => Promise<void>) {
    this.memory = new InMemoryPermissionStore(records);
  }

  get(appName: string, appIdentity?: string) { return this.memory.get(appName, appIdentity); }
  records() { return this.memory.records(); }
  async set(appName: string, level: PermissionLevel, appIdentity?: string) {
    this.memory.set(appName, level, appIdentity);
    await this.persist(appName, level, appIdentity);
  }
}

export class TaskRuntime {
  private active: ActiveTask | undefined;
  private readonly permissions: PersistentPermissionStore;
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(private readonly options: TaskRuntimeOptions) {
    this.permissions = new PersistentPermissionStore(options.settings.persisted.permissions, (appName, level, appIdentity) => options.settings.setPermission(appName, level, appIdentity));
  }

  get isRunning(): boolean { return this.active !== undefined; }
  get permissionRecords(): PermissionRecord[] { return this.permissions.records(); }

  async start(command: string, requestedThreadId?: string): Promise<void> {
    if (this.active) throw new OpenUseError("UNSUPPORTED_ACTION", "Another task is already running.");
    const taskId = randomUUID();
    const abort = new AbortController();
    const startedAt = Date.now();
    let actionCount = 0;
    let stepCount = 0;
    const stored = this.options.settings.persisted;
    const providerId: ProviderId = stored.provider;
    const modelId = providerId === "custom-openai-compatible"
      ? stored.customProvider.modelId
      : isNamedProvider(providerId)
        ? stored.namedProviders[providerId].modelId || "default"
        : stored.modelId;
    const model = providerId === "custom-openai-compatible"
      ? customModelDefinition({ baseUrl: stored.customProvider.baseUrl, modelId, capabilities: stored.customProvider.capabilities })
      : isNamedProvider(providerId)
        ? namedProviderModelDefinition(providerId, stored.namedProviders[providerId].modelId)
      : getModelDefinition(modelId, this.options.getModels());
    const capabilities = model?.capabilities ?? { toolCalling: false, vision: false };
    const reasoningEffort = resolveReasoningEffort(model, stored.reasoningEffort) ?? "provider-default";
    const threadId = requestedThreadId ?? this.options.threads?.snapshot().currentThreadId;
    const threadContext = threadId && this.options.threads?.continuationContext(threadId);
    if (this.options.threads) {
      await this.options.threads.beginTask({ threadId: threadId ?? "", taskId, command, modelId, provider: providerId, reasoningEffort, startedAt: new Date(startedAt).toISOString() });
    }
    this.options.usage.beginTask({ taskId, modelId, provider: providerId, reasoningEffort });
    this.emit({ type: "task.started", taskId, threadId, command, modelId, capabilities, at: nowIso() });
    this.emit({ type: "engine.status", status: this.options.engine.status, at: nowIso() });

    const prompt: PermissionPrompt = { request: (request, signal) => this.waitForPermission(taskId, request, signal) };
    const permissionEngine = new PermissionEngine(this.permissions, prompt);
    const provider = providerId === "custom-openai-compatible"
      ? new CustomOpenAICompatibleProvider({
          readApiKey: this.options.readCustomApiKey,
          baseUrl: stored.customProvider.baseUrl,
          modelId,
          capabilities: stored.customProvider.capabilities,
        })
      : providerId === "vercel-gateway"
        ? new GatewayModelProvider(this.options.readApiKey, this.options.getModels())
        : undefined;
    const agent = new ComputerUseAgent(provider, new NativeComputerController(this.options.engine), permissionEngine);
    const finish = (status: "completed" | "stopped" | "error", summary: string, resultActionCount: number, durationMs: number, errorCode?: OpenUseErrorCode) => {
      this.options.usage.finishTask(taskId, status, stepCount, resultActionCount, durationMs);
      this.emit({ type: "task.finished", taskId, status, summary, actionCount: resultActionCount, durationMs, ...(errorCode ? { errorCode } : {}), at: nowIso() });
    };
    const onEvent = (event: RuntimeEvent): void => {
      if (event.type === "agent.step") stepCount = Math.max(stepCount, event.step);
      if (event.type === "action.started") {
        actionCount += 1;
        this.options.usage.recordAction(taskId);
      }
      if (event.type === "model.usage") {
        this.options.usage.recordRequest({ taskId, step: event.step, modelId: event.modelId, provider: event.provider, inputTokens: event.inputTokens, outputTokens: event.outputTokens, actualCost: event.actualCost });
        const usage = this.options.usage.snapshot();
        event = { ...event, taskCost: this.options.usage.taskCost(taskId), lifetimeSpend: usage.totalKnownSpend };
      }
      this.emit(event);
      if (event.type === "action.completed" || event.type === "action.failed") this.emit({ type: "engine.status", status: this.options.engine.status, at: nowIso() });
    };
    const externalRun = isNamedProvider(providerId)
      ? this.options.namedProviders.run({ provider: providerId, settings: stored, taskId, command, modelId, reasoningEffort, threadContext, abortSignal: abort.signal, agent, onEvent }).then((result) => {
          stepCount = Math.max(stepCount, 1);
          onEvent({ type: "model.usage", taskId, step: stepCount, modelId, provider: providerId, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, reasoningEffort, costSource: "unknown", taskCost: 0, lifetimeSpend: 0, at: nowIso() });
          return { status: "completed" as const, summary: result.summary, actionCount: result.actionCount, errorCode: undefined };
        })
      : agent.run({
          taskId,
          command,
          modelId,
          maxActions: 30,
          abortSignal: abort.signal,
          reasoningEffort,
          threadContext,
          contextWindow: model?.contextWindow,
          qualificationMode: this.options.qualificationMode,
          onEvent,
        });
    const promise = externalRun.then((result) => {
      finish(result.status, result.summary, result.actionCount, Date.now() - startedAt, result.errorCode);
    }).catch((error) => {
      const openUseError = asOpenUseError(error, "MODEL_FAILED");
      const stopped = openUseError.code === "TASK_CANCELLED";
      finish(stopped ? "stopped" : "error", stopped ? "Task stopped." : openUseError.message, actionCount, Date.now() - startedAt, openUseError.code);
    }).finally(() => {
      if (this.active?.taskId === taskId) this.active = undefined;
      for (const [id, pending] of this.pendingPermissions) {
        if (pending.taskId !== taskId) continue;
        pending.reject(new OpenUseError("TASK_CANCELLED", "The task ended."));
        this.pendingPermissions.delete(id);
      }
      this.emit({ type: "engine.status", status: this.options.engine.status, at: nowIso() });
    });
    this.active = { taskId, abort, promise };
    await promise;
  }

  async stop(): Promise<void> {
    const active = this.active;
    if (!active) return;
    active.abort.abort();
    for (const [id, pending] of this.pendingPermissions) {
      if (pending.taskId !== active.taskId) continue;
      pending.reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
      this.pendingPermissions.delete(id);
    }
    await this.options.engine.stop();
    await active.promise;
  }

  decidePermission(id: string, decision: PermissionDecision): void {
    const pending = this.pendingPermissions.get(id);
    if (!pending) return;
    this.pendingPermissions.delete(id);
    pending.resolve(decision);
  }

  async setPermission(appName: string, level: PermissionLevel, appIdentity?: string): Promise<void> {
    await this.permissions.set(appName, level, appIdentity);
  }

  settings(apiKeyConfigured: boolean, customApiKeyConfigured: boolean): AppSettings {
    return this.options.settings.publicSettings(apiKeyConfigured, customApiKeyConfigured);
  }

  private emit(event: RuntimeEvent): void {
    this.options.threads?.recordEvent(event);
    this.options.emit(event);
  }

  private waitForPermission(requestTaskId: string, request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    this.emit({ type: "permission.requested", taskId: requestTaskId, request, at: nowIso() });
    return new Promise<PermissionDecision>((resolve, reject) => {
      const abort = () => {
        this.pendingPermissions.delete(request.id);
        reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pendingPermissions.set(request.id, {
        taskId: requestTaskId,
        resolve: (decision) => {
          signal.removeEventListener("abort", abort);
          this.emit({ type: "permission.resolved", taskId: requestTaskId, requestId: request.id, decision, at: nowIso() });
          resolve(decision);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      });
    });
  }
}

function isNamedProvider(provider: ProviderId): provider is "codex" | "claude" | "opencode" {
  return provider === "codex" || provider === "claude" || provider === "opencode";
}
