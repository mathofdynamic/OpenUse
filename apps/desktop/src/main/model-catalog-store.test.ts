import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "@openuse/ai";
import { ModelCatalogStore } from "./model-catalog-store";

const temporaryDirectories: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function catalogPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openuse-model-catalog-"));
  temporaryDirectories.push(directory);
  return join(directory, "model-catalog.json");
}

const gatewayPayload = {
  object: "list",
  data: [{ id: "provider/vision-agent", name: "Vision Agent", owned_by: "provider", type: "language", tags: ["tool-use", "reasoning"], modalities: { input: ["text", "image"], output: ["text"] }, pricing: { input: "0.000001", output: "0.000002" } }],
};

describe("Gateway model catalog cache", () => {
  it("refreshes from the validated Gateway endpoint and persists the result", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify(gatewayPayload), { status: 200, headers: { "content-type": "application/json" } });
    const path = await catalogPath();
    const store = new ModelCatalogStore(path);
    await store.refresh();

    expect(store.snapshot().status).toMatchObject({ source: "gateway-live", count: 1, isRefreshing: false });
    expect(store.snapshot().models[0]).toMatchObject({ id: "provider/vision-agent", capabilities: { toolCalling: true, vision: true } });
  });

  it("uses a last valid cache when discovery fails", async () => {
    const path = await catalogPath();
    await writeFile(path, JSON.stringify({ version: 1, fetchedAt: new Date().toISOString(), models: MODEL_CATALOG }));
    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    const store = new ModelCatalogStore(path);
    await store.initialize();

    expect(store.snapshot().status).toMatchObject({ source: "gateway-cache", count: MODEL_CATALOG.length, isRefreshing: false });
    expect(store.snapshot().models[0].id).toBe(MODEL_CATALOG[0].id);
  });

  it("keeps cached models visible after a stale-cache refresh failure", async () => {
    const path = await catalogPath();
    await writeFile(path, JSON.stringify({ version: 1, fetchedAt: "2020-01-01T00:00:00.000Z", models: MODEL_CATALOG }));
    globalThis.fetch = async () => { throw new Error("network unavailable"); };
    const store = new ModelCatalogStore(path);
    await store.initialize();
    await store.refresh();

    expect(store.snapshot().status).toMatchObject({ source: "gateway-cache", count: MODEL_CATALOG.length, isRefreshing: false, error: "Model discovery is temporarily unavailable." });
    expect(store.snapshot().models).toHaveLength(MODEL_CATALOG.length);
  });
});
