import { randomUUID } from "node:crypto";
import { ComputerUseAgent } from "@openuse/agent";
import { GatewayModelProvider } from "@openuse/ai";
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
  type PermissionDecision,
  type PermissionRequest,
  type PermissionRecord,
  type RuntimeEvent,
} from "@openuse/shared";
import type { PermissionLevel } from "@openuse/shared";
import type { SettingsStore } from "./settings-store";
import type { NativeEngineProcess } from "./native-process";

interface TaskRuntimeOptions {
  settings: SettingsStore;
  engine: NativeEngineProcess;
  readApiKey: () => Promise<string | undefined>;
  emit: (event: RuntimeEvent) => void;
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

  constructor(
    records: PermissionRecord[],
    private readonly persist: (appName: string, level: PermissionLevel) => Promise<void>,
  ) {
    this.memory = new InMemoryPermissionStore(records);
  }

  get(appName: string) { return this.memory.get(appName); }
  records() { return this.memory.records(); }
  async set(appName: string, level: PermissionLevel) {
    this.memory.set(appName, level);
    await this.persist(appName, level);
  }
}

export class TaskRuntime {
  private active: ActiveTask | undefined;
  private readonly permissions: PersistentPermissionStore;
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(private readonly options: TaskRuntimeOptions) {
    this.permissions = new PersistentPermissionStore(
      options.settings.persisted.permissions,
      (appName, level) => options.settings.setPermission(appName, level),
    );
  }

  get isRunning(): boolean {
    return this.active !== undefined;
  }

  get permissionRecords(): PermissionRecord[] {
    return this.permissions.records();
  }

  async start(command: string): Promise<void> {
    if (this.active) throw new OpenUseError("UNSUPPORTED_ACTION", "Another task is already running.");
    const taskId = randomUUID();
    const abort = new AbortController();
    const startedAt = Date.now();
    let actionCount = 0;
    const modelId = this.options.settings.persisted.modelId;
    this.options.emit({ type: "task.started", taskId, command, modelId, at: nowIso() });
    this.options.emit({ type: "engine.status", status: this.options.engine.status, at: nowIso() });

    const prompt: PermissionPrompt = {
      request: (request, signal) => this.waitForPermission(taskId, request, signal),
    };
    const permissionEngine = new PermissionEngine(this.permissions, prompt);
    const agent = new ComputerUseAgent(
      new GatewayModelProvider(this.options.readApiKey),
      new NativeComputerController(this.options.engine),
      permissionEngine,
    );
    const promise = agent.run({
      taskId,
      command,
      modelId,
      maxActions: 30,
      abortSignal: abort.signal,
      onEvent: (event) => {
        if (event.type === "action.started") actionCount += 1;
        this.options.emit(event);
      },
    }).then((result) => {
      this.options.emit({
        type: "task.finished",
        taskId,
        status: result.status,
        summary: result.summary,
        actionCount: result.actionCount,
        durationMs: Date.now() - startedAt,
        errorCode: result.errorCode,
        at: nowIso(),
      });
    }).catch((error) => {
      const openUseError = asOpenUseError(error, "MODEL_FAILED");
      const stopped = openUseError.code === "TASK_CANCELLED";
      this.options.emit({
        type: "task.finished",
        taskId,
        status: stopped ? "stopped" : "error",
        summary: stopped ? "Task stopped." : openUseError.message,
        actionCount,
        durationMs: Date.now() - startedAt,
        errorCode: openUseError.code,
        at: nowIso(),
      });
    }).finally(() => {
      if (this.active?.taskId === taskId) this.active = undefined;
      for (const [id, pending] of this.pendingPermissions) {
        if (pending.taskId !== taskId) continue;
        pending.reject(new OpenUseError("TASK_CANCELLED", "The task ended."));
        this.pendingPermissions.delete(id);
      }
      this.options.emit({ type: "engine.status", status: this.options.engine.status, at: nowIso() });
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

  async setPermission(appName: string, level: PermissionLevel): Promise<void> {
    await this.permissions.set(appName, level);
  }

  settings(apiKeyConfigured: boolean): AppSettings {
    return this.options.settings.publicSettings(apiKeyConfigured);
  }

  private waitForPermission(requestTaskId: string, request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    this.options.emit({ type: "permission.requested", taskId: requestTaskId, request, at: nowIso() });
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
          this.options.emit({ type: "permission.resolved", taskId: requestTaskId, requestId: request.id, decision, at: nowIso() });
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
