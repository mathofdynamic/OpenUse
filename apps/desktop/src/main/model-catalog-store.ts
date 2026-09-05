import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GATEWAY_MODELS_URL, MODEL_CATALOG, parseGatewayCatalog } from "@openuse/ai";
import type { ModelCatalogStatus, ModelDefinition } from "@openuse/shared";

const CACHE_VERSION = 1;
const REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

interface CatalogCacheFile {
  version: typeof CACHE_VERSION;
  fetchedAt: string;
  models: ModelDefinition[];
}

export interface ModelCatalogSnapshot {
  models: ModelDefinition[];
  status: ModelCatalogStatus;
}

export class ModelCatalogStore {
  private models: ModelDefinition[] = MODEL_CATALOG.map((model) => ({ ...model, capabilities: { ...model.capabilities, reasoningEfforts: model.capabilities.reasoningEfforts ? [...model.capabilities.reasoningEfforts] : undefined } }));
  private status: ModelCatalogStatus = { source: "bundled-fallback", isRefreshing: false, count: this.models.length };
  private refreshPromise: Promise<void> | undefined;
  private onChangeHandler: (() => void) | undefined;

  constructor(private readonly filePath: string) {}

  onChange(handler: () => void): void { this.onChangeHandler = handler; }

  async initialize(): Promise<void> {
    const cached = await this.readCache();
    if (cached) {
      this.models = cached.models;
      this.status = { source: "gateway-cache", fetchedAt: cached.fetchedAt, isRefreshing: false, count: cached.models.length };
      if (Date.now() - Date.parse(cached.fetchedAt) > REFRESH_TTL_MS) void this.refresh();
      return;
    }
    void this.refresh();
  }

  snapshot(): ModelCatalogSnapshot {
    return {
      models: this.models.map((model) => ({ ...model, capabilities: { ...model.capabilities, reasoningEfforts: model.capabilities.reasoningEfforts ? [...model.capabilities.reasoningEfforts] : undefined }, pricing: model.pricing ? { ...model.pricing } : undefined })),
      status: { ...this.status },
    };
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.status = { ...this.status, isRefreshing: true, error: undefined };
    this.onChangeHandler?.();
    this.refreshPromise = this.fetchCatalog().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async fetchCatalog(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      let response: Response;
      try {
        response = await fetch(GATEWAY_MODELS_URL, { signal: controller.signal, headers: { accept: "application/json" } });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Gateway model catalog returned HTTP ${response.status}.`);
      const models = parseGatewayCatalog(await response.json());
      if (models.length === 0) throw new Error("Gateway model catalog was empty.");
      const fetchedAt = new Date().toISOString();
      this.models = models;
      this.status = { source: "gateway-live", fetchedAt, isRefreshing: false, count: models.length };
      await this.writeCache({ version: CACHE_VERSION, fetchedAt, models });
    } catch (error) {
      this.status = {
        ...this.status,
        isRefreshing: false,
        error: error instanceof Error && error.name === "AbortError" ? "Model discovery timed out." : "Model discovery is temporarily unavailable.",
        count: this.models.length,
      };
    } finally {
      this.onChangeHandler?.();
    }
  }

  private async readCache(): Promise<CatalogCacheFile | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<CatalogCacheFile>;
      if (parsed.version !== CACHE_VERSION || typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.models) || parsed.models.length === 0) return undefined;
      const parsedAt = Date.parse(parsed.fetchedAt);
      if (!Number.isFinite(parsedAt)) return undefined;
      const models = parsed.models.filter((model): model is ModelDefinition => Boolean(model) && typeof model.id === "string" && typeof model.label === "string" && Boolean(model.capabilities));
      return models.length > 0 ? { version: CACHE_VERSION, fetchedAt: parsed.fetchedAt, models } : undefined;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      return undefined;
    }
  }

  private async writeCache(value: CatalogCacheFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

export const MODEL_CATALOG_REFRESH_TTL_MS = REFRESH_TTL_MS;
