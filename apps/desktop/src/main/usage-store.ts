import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderId, ReasoningEffort, UsageSummary } from "@openuse/shared";
import type { UsageProfile } from "@openuse/ai";

const USAGE_VERSION = 1 as const;

export interface UsageTaskRecord {
  id: string;
  timestamp: string;
  modelId: string;
  provider: ProviderId;
  reasoningEffort: ReasoningEffort;
  status: "completed" | "stopped" | "error";
  steps: number;
  actions: number;
  inputTokens: number;
  outputTokens: number;
  actualKnownCost: number;
  requestCount: number;
  knownCostRequests: number;
  unpricedRequests: number;
  durationMs: number;
}

interface UsageFile {
  version: typeof USAGE_VERSION;
  records: UsageTaskRecord[];
}

interface ActiveTask {
  record: UsageTaskRecord;
  requestKeys: Set<string>;
}

export interface UsageRequest {
  taskId: string;
  step: number;
  modelId: string;
  provider: ProviderId;
  inputTokens?: number;
  outputTokens?: number;
  actualCost?: number;
}

export class UsageStore {
  private records: UsageTaskRecord[] = [];
  private readonly active = new Map<string, ActiveTask>();
  private writePromise: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<UsageFile>;
      this.records = parsed.version === USAGE_VERSION && Array.isArray(parsed.records) ? parsed.records.map(sanitizeRecord).filter((record): record is UsageTaskRecord => Boolean(record)) : [];
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await this.persist();
    }
  }

  beginTask(input: { taskId: string; modelId: string; provider: ProviderId; reasoningEffort: ReasoningEffort; timestamp?: string }): void {
    this.active.set(input.taskId, {
      requestKeys: new Set(),
      record: {
        id: input.taskId,
        timestamp: input.timestamp ?? new Date().toISOString(),
        modelId: input.modelId,
        provider: input.provider,
        reasoningEffort: input.reasoningEffort,
        status: "error",
        steps: 0,
        actions: 0,
        inputTokens: 0,
        outputTokens: 0,
        actualKnownCost: 0,
        requestCount: 0,
        knownCostRequests: 0,
        unpricedRequests: 0,
        durationMs: 0,
      },
    });
  }

  recordAction(taskId: string): void {
    const task = this.active.get(taskId);
    if (task) task.record.actions += 1;
  }

  recordRequest(request: UsageRequest): void {
    const task = this.active.get(request.taskId);
    if (!task) return;
    const key = `${request.step}:${request.modelId}:${request.provider}`;
    if (task.requestKeys.has(key)) return;
    task.requestKeys.add(key);
    task.record.steps = Math.max(task.record.steps, request.step);
    task.record.requestCount += 1;
    task.record.inputTokens += finiteTokenCount(request.inputTokens);
    task.record.outputTokens += finiteTokenCount(request.outputTokens);
    if (isKnownCost(request.actualCost)) {
      task.record.actualKnownCost += request.actualCost;
      task.record.knownCostRequests += 1;
    } else {
      task.record.unpricedRequests += 1;
    }
  }

  taskCost(taskId: string): number {
    return this.active.get(taskId)?.record.actualKnownCost ?? this.records.find((record) => record.id === taskId)?.actualKnownCost ?? 0;
  }

  finishTask(taskId: string, status: UsageTaskRecord["status"], steps: number, actions: number, durationMs: number): void {
    const task = this.active.get(taskId);
    if (!task) return;
    task.record.status = status;
    task.record.steps = Math.max(task.record.steps, finiteTokenCount(steps));
    task.record.actions = Math.max(task.record.actions, finiteTokenCount(actions));
    task.record.durationMs = Math.max(0, finiteTokenCount(durationMs));
    this.records.push(task.record);
    this.active.delete(taskId);
    void this.persist();
  }

  snapshot(): UsageSummary {
    const records = [...this.records, ...[...this.active.values()].map(({ record }) => record)];
    const totalKnownSpend = records.reduce((sum, record) => sum + record.actualKnownCost, 0);
    const completed = records.filter((record) => record.status === "completed");
    const pricedTasks = completed.filter((record) => record.knownCostRequests > 0);
    const modelMap = new Map<string, { modelId: string; provider: ProviderId; requestCount: number; taskCount: number; knownSpend: number; inputTokens: number; outputTokens: number }>();
    for (const record of records) {
      const key = `${record.provider}:${record.modelId}`;
      const model = modelMap.get(key) ?? { modelId: record.modelId, provider: record.provider, requestCount: 0, taskCount: 0, knownSpend: 0, inputTokens: 0, outputTokens: 0 };
      model.requestCount += record.requestCount;
      model.taskCount += 1;
      model.knownSpend += record.actualKnownCost;
      model.inputTokens += record.inputTokens;
      model.outputTokens += record.outputTokens;
      modelMap.set(key, model);
    }
    return {
      totalKnownSpend,
      totalTasks: records.length,
      completedTasks: completed.length,
      inputTokens: records.reduce((sum, record) => sum + record.inputTokens, 0),
      outputTokens: records.reduce((sum, record) => sum + record.outputTokens, 0),
      knownCostRequests: records.reduce((sum, record) => sum + record.knownCostRequests, 0),
      unpricedRequests: records.reduce((sum, record) => sum + record.unpricedRequests, 0),
      averageTaskCost: pricedTasks.length > 0 ? pricedTasks.reduce((sum, record) => sum + record.actualKnownCost, 0) / pricedTasks.length : undefined,
      modelUsage: [...modelMap.values()].sort((left, right) => right.knownSpend - left.knownSpend),
      lastUpdatedAt: records.at(-1)?.timestamp,
    };
  }

  profile(modelId?: string): UsageProfile | undefined {
    const candidates = this.records.filter((record) => record.requestCount > 0 && (!modelId || record.modelId === modelId));
    if (candidates.length === 0) return undefined;
    const requestCount = candidates.reduce((sum, record) => sum + record.requestCount, 0);
    return {
      inputTokensPerStep: candidates.reduce((sum, record) => sum + record.inputTokens, 0) / requestCount,
      outputTokensPerStep: candidates.reduce((sum, record) => sum + record.outputTokens, 0) / requestCount,
      source: modelId ? "model" : "general",
    };
  }

  async reset(): Promise<void> {
    this.records = [];
    this.active.clear();
    await this.persist();
  }

  async flush(): Promise<void> {
    await this.writePromise;
  }

  private async persist(): Promise<void> {
    const value: UsageFile = { version: USAGE_VERSION, records: this.records };
    this.writePromise = this.writePromise.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    return this.writePromise;
  }
}

function finiteTokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function isKnownCost(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function sanitizeRecord(value: unknown): UsageTaskRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<UsageTaskRecord>;
  if (typeof record.id !== "string" || typeof record.timestamp !== "string" || typeof record.modelId !== "string") return undefined;
  const provider: ProviderId = record.provider === "custom-openai-compatible" ? record.provider : "vercel-gateway";
  const effort: ReasoningEffort = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"].includes(record.reasoningEffort as ReasoningEffort) ? record.reasoningEffort as ReasoningEffort : "provider-default";
  const status = record.status === "completed" || record.status === "stopped" ? record.status : "error";
  return {
    id: record.id.slice(0, 100),
    timestamp: record.timestamp,
    modelId: record.modelId.slice(0, 240),
    provider,
    reasoningEffort: effort,
    status,
    steps: finiteTokenCount(record.steps),
    actions: finiteTokenCount(record.actions),
    inputTokens: finiteTokenCount(record.inputTokens),
    outputTokens: finiteTokenCount(record.outputTokens),
    actualKnownCost: isKnownCost(record.actualKnownCost) ? record.actualKnownCost : 0,
    requestCount: finiteTokenCount(record.requestCount),
    knownCostRequests: finiteTokenCount(record.knownCostRequests),
    unpricedRequests: finiteTokenCount(record.unpricedRequests),
    durationMs: finiteTokenCount(record.durationMs),
  };
}
