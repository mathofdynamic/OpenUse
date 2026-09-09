import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadStore } from "./thread-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), "openuse-threads-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "threads.json");
  const store = new ThreadStore(path);
  await store.initialize();
  return { store, path };
}

describe("thread history store", () => {
  it("persists folders, selected threads, and safe task metrics", async () => {
    const { store, path } = await createStore();
    const folderSnapshot = await store.createFolder("Windows work");
    const folder = folderSnapshot.folders[0];
    const snapshot = await store.createThread(folder.id);
    const thread = snapshot.threads.find((item) => item.id === snapshot.currentThreadId)!;

    await store.beginTask({ threadId: thread.id, taskId: "task-1", command: "Open Notepad and type a message", modelId: "model-a", provider: "vercel-gateway", reasoningEffort: "high", startedAt: "2026-09-09T10:00:00.000Z" });
    store.recordEvent({ type: "agent.step", taskId: "task-1", step: 2, actionCount: 1, modelId: "model-a", at: "2026-09-09T10:00:01.000Z" });
    store.recordEvent({ type: "action.started", taskId: "task-1", action: { actionId: "action-1", tool: "computer_click_element", summary: "Click button", status: "running", retryCount: 0 }, at: "2026-09-09T10:00:02.000Z" });
    store.recordEvent({ type: "model.usage", taskId: "task-1", step: 2, modelId: "model-a", provider: "vercel-gateway", inputTokens: 100, outputTokens: 30, reasoningEffort: "high", actualCost: 0.0021, costSource: "gateway", taskCost: 0.0021, lifetimeSpend: 0.0021, at: "2026-09-09T10:00:03.000Z" });
    store.recordEvent({ type: "model.usage", taskId: "task-1", step: 2, modelId: "model-a", provider: "vercel-gateway", inputTokens: 100, outputTokens: 30, reasoningEffort: "high", actualCost: 0.0021, costSource: "gateway", taskCost: 0.0021, lifetimeSpend: 0.0021, at: "2026-09-09T10:00:03.000Z" });
    store.recordEvent({ type: "task.finished", taskId: "task-1", status: "completed", summary: "Done", actionCount: 1, durationMs: 3_000, at: "2026-09-09T10:00:04.000Z" });
    await store.flush();

    const task = store.snapshot().threads.find((item) => item.id === thread.id)!.tasks[0];
    expect(task).toMatchObject({ status: "completed", steps: 2, actions: 1, inputTokens: 100, outputTokens: 30, knownCost: 0.0021, knownCostRequests: 1 });
    const persisted = await readFile(path, "utf8");
    expect(persisted).toContain("Open Notepad and type a message");
    expect(persisted).not.toContain("accessibility tree");
    expect(persisted).not.toContain("screenshot");

    const restored = new ThreadStore(path);
    await restored.initialize();
    expect(restored.snapshot().currentThreadId).toBe(thread.id);
    expect(restored.snapshot().threads.find((item) => item.id === thread.id)?.folderId).toBe(folder.id);
  });

  it("compacts continuation context without deleting visible task history", async () => {
    const { store } = await createStore();
    const threadId = store.snapshot().currentThreadId;
    for (let index = 0; index < 7; index += 1) {
      const taskId = `task-${index}`;
      await store.beginTask({ threadId, taskId, command: `Task ${index} with useful continuation context`, modelId: "model-a", provider: "vercel-gateway", reasoningEffort: "provider-default" });
      store.recordEvent({ type: "task.finished", taskId, status: "completed", summary: "Done", actionCount: index, durationMs: 100, at: new Date(2026, 8, 9, 10, index).toISOString() });
    }
    await store.flush();

    const thread = store.snapshot().threads.find((item) => item.id === threadId)!;
    expect(thread.tasks).toHaveLength(7);
    expect(thread.contextCompactedAt).toBeDefined();
    const context = store.continuationContext(threadId);
    expect(context).toContain("Earlier thread history was compacted");
    expect(context).toContain("Task 6");
    expect(context.length).toBeLessThanOrEqual(6_000);
  });
});
