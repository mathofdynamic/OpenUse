import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { UsageSummary } from "@openuse/shared";
import { UsageStore } from "./usage-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStoreAt(path: string): Promise<UsageStore> {
  const store = new UsageStore(path);
  await store.initialize();
  return store;
}

async function createStore(): Promise<UsageStore> {
  const directory = await mkdtemp(join(tmpdir(), "openuse-usage-"));
  temporaryDirectories.push(directory);
  return createStoreAt(join(directory, "usage.json"));
}

describe("privacy-safe usage ledger", () => {
  it("accumulates known request costs once and persists task metadata without command text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openuse-usage-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "usage.json");
    const store = await createStoreAt(path);
    store.beginTask({ taskId: "task-1", modelId: "openai/gpt-5.6-luna", provider: "vercel-gateway", reasoningEffort: "high", timestamp: "2026-09-05T10:00:00.000Z" });
    store.recordAction("task-1");
    store.recordRequest({ taskId: "task-1", step: 1, modelId: "openai/gpt-5.6-luna", provider: "vercel-gateway", inputTokens: 1_000, outputTokens: 200, actualCost: 0.0021 });
    store.recordRequest({ taskId: "task-1", step: 1, modelId: "openai/gpt-5.6-luna", provider: "vercel-gateway", inputTokens: 1_000, outputTokens: 200, actualCost: 0.0021 });
    store.recordRequest({ taskId: "task-1", step: 2, modelId: "openai/gpt-5.6-luna", provider: "vercel-gateway", inputTokens: 900, outputTokens: 100 });

    expect(store.taskCost("task-1")).toBe(0.0021);
    expect(store.snapshot()).toMatchObject<Partial<UsageSummary>>({ totalKnownSpend: 0.0021, totalTasks: 1, inputTokens: 1_900, outputTokens: 300, knownCostRequests: 1, unpricedRequests: 1 });

    store.finishTask("task-1", "completed", 2, 1, 1_250);
    await store.flush();
    const persisted = await readFile(path, "utf8");
    expect(persisted).not.toContain("private command");

    const restored = await createStoreAt(path);
    expect(restored.snapshot()).toMatchObject({ totalKnownSpend: 0.0021, completedTasks: 1, knownCostRequests: 1, unpricedRequests: 1 });
  });

  it("keeps model-specific profiles separate and supports a complete local reset", async () => {
    const store = await createStore();
    store.beginTask({ taskId: "task-a", modelId: "model-a", provider: "vercel-gateway", reasoningEffort: "low" });
    store.recordRequest({ taskId: "task-a", step: 1, modelId: "model-a", provider: "vercel-gateway", inputTokens: 100, outputTokens: 50, actualCost: 0.01 });
    store.finishTask("task-a", "completed", 1, 0, 100);
    await store.flush();
    expect(store.profile("model-a")).toEqual({ inputTokensPerStep: 100, outputTokensPerStep: 50, source: "model" });
    expect(store.profile("missing")).toBeUndefined();
    await store.reset();
    expect(store.snapshot().totalKnownSpend).toBe(0);
    expect(store.snapshot().totalTasks).toBe(0);
  });
});
