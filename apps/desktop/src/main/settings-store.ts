import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_MODEL_ID } from "@openuse/ai";
import { defaultPermissionRecords, normalizeAppName } from "@openuse/permissions";
import type { AppSettings, PermissionLevel, PermissionRecord, ProviderId } from "@openuse/shared";

interface PersistedSettings {
  version: 1 | 2;
  provider: ProviderId;
  modelId: string;
  permissions: PermissionRecord[];
}

const defaultSettings = (): PersistedSettings => ({
  version: 2,
  provider: "vercel-gateway",
  modelId: DEFAULT_MODEL_ID,
  permissions: defaultPermissionRecords(),
});

const LEGACY_DEFAULT_MODEL_ID = "openai/gpt-5.4";

export class SettingsStore {
  private value: PersistedSettings = defaultSettings();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedSettings>;
      const defaults = defaultSettings();
      const storedModelId = typeof parsed.modelId === "string" && parsed.modelId ? parsed.modelId : undefined;
      const migrateLegacyDefault = parsed.version === 1 && storedModelId === LEGACY_DEFAULT_MODEL_ID;
      this.value = {
        version: 2,
        provider: parsed.provider === "vercel-gateway" ? parsed.provider : defaults.provider,
        modelId: migrateLegacyDefault ? defaults.modelId : storedModelId ?? defaults.modelId,
        permissions: Array.isArray(parsed.permissions) ? sanitizePermissions(parsed.permissions) : defaults.permissions,
      };
      if (parsed.version !== 2 || migrateLegacyDefault) await this.persist();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await this.persist();
    }
  }

  get persisted(): PersistedSettings {
    return {
      ...this.value,
      permissions: this.value.permissions.map((record) => ({ ...record })),
    };
  }

  async setModel(modelId: string): Promise<void> {
    this.value.modelId = modelId;
    await this.persist();
  }

  async setPermission(appName: string, level: PermissionLevel, appIdentity?: string): Promise<void> {
    const normalized = normalizeAppName(appName);
    const normalizedIdentity = appIdentity ? normalizeAppName(appIdentity) : undefined;
    const existing = this.value.permissions.find((record) => {
      if (normalizedIdentity && record.appIdentity) return record.appIdentity.toLowerCase() === normalizedIdentity.toLowerCase();
      return record.appName.toLowerCase() === normalized.toLowerCase();
    });
    const record = {
      appName: normalized,
      appIdentity: normalizedIdentity ?? existing?.appIdentity,
      level,
      updatedAt: new Date().toISOString(),
    };
    if (existing) Object.assign(existing, record);
    else this.value.permissions.push(record);
    await this.persist();
  }

  publicSettings(apiKeyConfigured: boolean): AppSettings {
    return {
      provider: this.value.provider,
      modelId: this.value.modelId,
      apiKeyConfigured,
      permissions: this.value.permissions.map((record) => ({ ...record })),
    };
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}

function sanitizePermissions(records: PermissionRecord[]): PermissionRecord[] {
  const valid = records.filter(
    (record): record is PermissionRecord =>
      Boolean(record) && typeof record.appName === "string" && normalizeAppName(record.appName).length > 0 && ["ALLOW", "ASK", "DENY"].includes(record.level),
  ).map((record) => ({
    appName: normalizeAppName(record.appName),
    appIdentity: typeof record.appIdentity === "string" && normalizeAppName(record.appIdentity).length > 0
      ? normalizeAppName(record.appIdentity)
      : undefined,
    level: record.level,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  }));
  return valid.length > 0 ? valid : defaultPermissionRecords();
}
