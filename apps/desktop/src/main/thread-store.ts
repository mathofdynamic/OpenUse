import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import {
  nowIso,
  type ProviderId,
  type ReasoningEffort,
  type RuntimeEvent,
  type ThreadFolder,
  type ThreadRecord,
  type ThreadSnapshot,
  type ThreadTaskRecord,
  type ThreadTaskStatus,
} from "@openuse/shared";

export const THREADS_VERSION = 1 as const;
export const DEFAULT_THREAD_TITLE = "New thread";
export const THREAD_CONTEXT_LIMIT = 6_000;
export const THREAD_CONTEXT_TASK_LIMIT = 5;

const MAX_THREADS = 200;
const MAX_TASKS_PER_THREAD = 80;
const MAX_FOLDER_NAME = 80;
const MAX_THREAD_TITLE = 160;
const MAX_COMMAND_LENGTH = 10_000;
const THREAD_STATUSES: ThreadTaskStatus[] = ["running", "completed", "stopped", "error"];
const PROVIDERS: ProviderId[] = ["vercel-gateway", "custom-openai-compatible", "codex", "claude", "opencode"];
const REASONING: ReasoningEffort[] = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"];

const persistedFileSchema = z.object({
  version: z.number().int().optional(),
  currentThreadId: z.string().optional(),
  folders: z.array(z.unknown()).optional(),
  threads: z.array(z.unknown()).optional(),
});

export interface BeginThreadTaskInput {
  threadId: string;
  taskId: string;
  command: string;
  modelId: string;
  provider: ProviderId;
  reasoningEffort: ReasoningEffort;
  startedAt?: string;
}

interface PersistedThreadFile {
  version: typeof THREADS_VERSION;
  currentThreadId: string;
  folders: ThreadFolder[];
  threads: ThreadRecord[];
}

function boundedString(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function safeId(value: unknown, fallback = randomUUID()): string {
  return boundedString(value, fallback, 120);
}

function safeIso(value: unknown, fallback = nowIso()): string {
  if (typeof value !== "string") return fallback;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? fallback : timestamp.toISOString();
}

function safeCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100_000_000, Math.floor(value))) : 0;
}

function safeCost(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(10_000_000, value)) : 0;
}

function sanitizeFolder(value: unknown): ThreadFolder | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = boundedString(record.name, "", MAX_FOLDER_NAME);
  if (!name) return undefined;
  const createdAt = safeIso(record.createdAt);
  return {
    id: safeId(record.id),
    name,
    createdAt,
    updatedAt: safeIso(record.updatedAt, createdAt),
  };
}

function sanitizeTask(value: unknown): ThreadTaskRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const command = boundedString(record.command, "", MAX_COMMAND_LENGTH);
  const modelId = boundedString(record.modelId, "unknown", 240);
  if (!command || !modelId) return undefined;
  const startedAt = safeIso(record.startedAt);
  const status = THREAD_STATUSES.includes(record.status as ThreadTaskStatus) ? record.status as ThreadTaskStatus : "error";
  return {
    id: safeId(record.id),
    command,
    modelId,
    provider: PROVIDERS.includes(record.provider as ProviderId) ? record.provider as ProviderId : "vercel-gateway",
    reasoningEffort: REASONING.includes(record.reasoningEffort as ReasoningEffort) ? record.reasoningEffort as ReasoningEffort : "provider-default",
    status,
    startedAt,
    updatedAt: safeIso(record.updatedAt, startedAt),
    ...(record.finishedAt ? { finishedAt: safeIso(record.finishedAt, startedAt) } : {}),
    steps: safeCount(record.steps),
    actions: safeCount(record.actions),
    inputTokens: safeCount(record.inputTokens),
    outputTokens: safeCount(record.outputTokens),
    knownCost: safeCost(record.knownCost),
    knownCostRequests: safeCount(record.knownCostRequests),
    unpricedRequests: safeCount(record.unpricedRequests),
    durationMs: safeCount(record.durationMs),
  };
}

function sanitizeThread(value: unknown): ThreadRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const tasks = Array.isArray(record.tasks) ? record.tasks.map(sanitizeTask).filter((task): task is ThreadTaskRecord => Boolean(task)).slice(-MAX_TASKS_PER_THREAD) : [];
  const createdAt = safeIso(record.createdAt);
  const contextSummary = typeof record.contextSummary === "string" ? record.contextSummary.trim().slice(0, THREAD_CONTEXT_LIMIT) : undefined;
  return {
    id: safeId(record.id),
    title: boundedString(record.title, DEFAULT_THREAD_TITLE, MAX_THREAD_TITLE),
    ...(typeof record.folderId === "string" && record.folderId.trim() ? { folderId: record.folderId.trim().slice(0, 120) } : {}),
    createdAt,
    updatedAt: safeIso(record.updatedAt, createdAt),
    tasks,
    ...(contextSummary ? { contextSummary } : {}),
    ...(record.contextCompactedAt ? { contextCompactedAt: safeIso(record.contextCompactedAt, createdAt) } : {}),
  };
}

export function createDefaultThread(at = nowIso()): ThreadRecord {
  return {
    id: randomUUID(),
    title: DEFAULT_THREAD_TITLE,
    createdAt: at,
    updatedAt: at,
    tasks: [],
  };
}

export function sanitizeThreadFile(value: unknown): PersistedThreadFile {
  const parsed = persistedFileSchema.safeParse(value);
  const raw = parsed.success ? parsed.data : {};
  const folders = (raw.folders ?? []).map(sanitizeFolder).filter((folder): folder is ThreadFolder => Boolean(folder)).slice(0, 100);
  const folderIds = new Set(folders.map((folder) => folder.id));
  const threads = (raw.threads ?? []).map(sanitizeThread).filter((thread): thread is ThreadRecord => Boolean(thread)).slice(0, MAX_THREADS);
  const uniqueThreads: ThreadRecord[] = [];
  const threadIds = new Set<string>();
  for (const thread of threads) {
    if (threadIds.has(thread.id)) continue;
    if (thread.folderId && !folderIds.has(thread.folderId)) delete thread.folderId;
    threadIds.add(thread.id);
    uniqueThreads.push(thread);
  }
  const fallbackThread = createDefaultThread();
  if (uniqueThreads.length === 0) uniqueThreads.push(fallbackThread);
  const requestedCurrent = typeof raw.currentThreadId === "string" ? raw.currentThreadId : "";
  return {
    version: THREADS_VERSION,
    currentThreadId: threadIds.has(requestedCurrent) ? requestedCurrent : uniqueThreads[0].id,
    folders,
    threads: uniqueThreads,
  };
}

export function threadTitleFromCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim();
  if (!compact) return DEFAULT_THREAD_TITLE;
  return compact.length > 64 ? `${compact.slice(0, 61)}…` : compact;
}

function taskLine(task: ThreadTaskRecord): string {
  return `- ${task.status}: ${task.command.slice(0, 1_200)} (${task.actions} actions, ${task.steps} steps, model ${task.modelId})`;
}

export function buildThreadContext(thread: ThreadRecord, limit = THREAD_CONTEXT_LIMIT): string {
  const recentTasks = thread.tasks.slice(-THREAD_CONTEXT_TASK_LIMIT);
  const sections = [
    thread.contextSummary,
    recentTasks.length > 0 ? `Recent tasks in this OpenUse thread:\n${recentTasks.map(taskLine).join("\n")}` : undefined,
  ].filter(Boolean).join("\n\n");
  return sections.slice(0, limit);
}

function compactThreadContext(thread: ThreadRecord, at = nowIso()): ThreadRecord {
  const context = buildThreadContext(thread);
  const shouldCompact = thread.tasks.length > THREAD_CONTEXT_TASK_LIMIT || context.length > THREAD_CONTEXT_LIMIT;
  if (!shouldCompact) return thread;
  const olderTasks = thread.tasks.slice(0, -THREAD_CONTEXT_TASK_LIMIT);
  const compactSummary = [
    thread.contextSummary,
    olderTasks.length > 0
      ? `Earlier thread history was compacted. ${olderTasks.length} earlier task(s) remain available in the local thread history.`
      : undefined,
  ].filter(Boolean).join(" ").slice(0, THREAD_CONTEXT_LIMIT);
  return {
    ...thread,
    contextSummary: compactSummary || undefined,
    contextCompactedAt: thread.contextCompactedAt ?? at,
  };
}

export class ThreadStore {
  private value: PersistedThreadFile = {
    version: THREADS_VERSION,
    currentThreadId: "",
    folders: [],
    threads: [],
  };
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly taskToThread = new Map<string, string>();
  private readonly usageKeys = new Set<string>();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      this.value = sanitizeThreadFile(parsed);
      await this.persist();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      this.value = sanitizeThreadFile(undefined);
      await this.persist();
    }
  }

  snapshot(): ThreadSnapshot {
    return {
      currentThreadId: this.value.currentThreadId,
      folders: this.value.folders.map((folder) => ({ ...folder })),
      threads: this.value.threads.map((thread) => ({
        ...thread,
        ...(thread.folderId ? { folderId: thread.folderId } : {}),
        tasks: thread.tasks.map((task) => ({ ...task })),
      })),
    };
  }

  continuationContext(threadId: string): string {
    const thread = this.requireThread(threadId);
    return buildThreadContext(thread);
  }

  async createThread(folderId?: string): Promise<ThreadSnapshot> {
    this.requireFolder(folderId);
    const timestamp = nowIso();
    const thread: ThreadRecord = {
      id: randomUUID(),
      title: DEFAULT_THREAD_TITLE,
      ...(folderId ? { folderId } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      tasks: [],
    };
    this.value.threads = [thread, ...this.value.threads].slice(0, MAX_THREADS);
    this.value.currentThreadId = thread.id;
    await this.persist();
    return this.snapshot();
  }

  async selectThread(threadId: string): Promise<ThreadSnapshot> {
    this.requireThread(threadId);
    this.value.currentThreadId = threadId;
    await this.persist();
    return this.snapshot();
  }

  async createFolder(name: string): Promise<ThreadSnapshot> {
    const normalized = boundedString(name, "", MAX_FOLDER_NAME);
    if (!normalized) throw new Error("Folder name cannot be empty.");
    if (this.value.folders.some((folder) => folder.name.toLowerCase() === normalized.toLowerCase())) {
      throw new Error("A folder with this name already exists.");
    }
    const timestamp = nowIso();
    this.value.folders.push({ id: randomUUID(), name: normalized, createdAt: timestamp, updatedAt: timestamp });
    await this.persist();
    return this.snapshot();
  }

  async moveThread(threadId: string, folderId?: string): Promise<ThreadSnapshot> {
    const thread = this.requireThread(threadId);
    this.requireFolder(folderId);
    if (folderId) thread.folderId = folderId;
    else delete thread.folderId;
    thread.updatedAt = nowIso();
    await this.persist();
    return this.snapshot();
  }

  async beginTask(input: BeginThreadTaskInput): Promise<void> {
    const thread = this.requireThread(input.threadId);
    const startedAt = safeIso(input.startedAt);
    const task: ThreadTaskRecord = {
      id: safeId(input.taskId),
      command: boundedString(input.command, "", MAX_COMMAND_LENGTH),
      modelId: boundedString(input.modelId, "unknown", 240),
      provider: input.provider,
      reasoningEffort: input.reasoningEffort,
      status: "running",
      startedAt,
      updatedAt: startedAt,
      steps: 0,
      actions: 0,
      inputTokens: 0,
      outputTokens: 0,
      knownCost: 0,
      knownCostRequests: 0,
      unpricedRequests: 0,
      durationMs: 0,
    };
    thread.tasks = [...thread.tasks, task].slice(-MAX_TASKS_PER_THREAD);
    if (thread.title === DEFAULT_THREAD_TITLE) thread.title = threadTitleFromCommand(task.command);
    thread.updatedAt = startedAt;
    this.taskToThread.set(input.taskId, thread.id);
    this.value.currentThreadId = thread.id;
    await this.persist();
  }

  recordEvent(event: RuntimeEvent): void {
    const taskId = "taskId" in event ? event.taskId : undefined;
    if (!taskId) return;
    const threadId = this.taskToThread.get(taskId);
    if (!threadId) return;
    const thread = this.value.threads.find((item) => item.id === threadId);
    const task = thread?.tasks.find((item) => item.id === taskId);
    if (!thread || !task) return;
    const timestamp = event.at;
    if (event.type === "agent.step") task.steps = Math.max(task.steps, event.step);
    if (event.type === "action.started") task.actions += 1;
    if (event.type === "model.usage") {
      const usageKey = `${taskId}:${event.step}`;
      if (!this.usageKeys.has(usageKey)) {
        this.usageKeys.add(usageKey);
        task.inputTokens += safeCount(event.inputTokens);
        task.outputTokens += safeCount(event.outputTokens);
        if (typeof event.actualCost === "number" && Number.isFinite(event.actualCost) && event.actualCost >= 0) {
          task.knownCost += safeCost(event.actualCost);
          task.knownCostRequests += 1;
        } else {
          task.unpricedRequests += 1;
        }
      }
    }
    if (event.type === "task.finished") {
      task.status = event.status;
      task.actions = Math.max(task.actions, event.actionCount);
      task.durationMs = safeCount(event.durationMs);
      task.finishedAt = safeIso(timestamp);
      this.taskToThread.delete(taskId);
    }
    task.updatedAt = safeIso(timestamp, nowIso());
    thread.updatedAt = task.updatedAt;
    const compacted = compactThreadContext(thread, task.updatedAt);
    Object.assign(thread, compacted);
    void this.persist();
  }

  async flush(): Promise<void> {
    await this.persistQueue;
  }

  private requireThread(threadId: string | undefined): ThreadRecord {
    if (!threadId) throw new Error("A thread must be selected before starting a task.");
    const thread = this.value.threads.find((item) => item.id === threadId);
    if (!thread) throw new Error("The selected thread no longer exists.");
    return thread;
  }

  private requireFolder(folderId: string | undefined): ThreadFolder | undefined {
    if (!folderId) return undefined;
    const folder = this.value.folders.find((item) => item.id === folderId);
    if (!folder) throw new Error("The selected thread folder no longer exists.");
    return folder;
  }

  private async persist(): Promise<void> {
    const operation = this.persistQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(this.value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    this.persistQueue = operation.catch(() => {});
    await operation;
  }
}
