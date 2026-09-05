import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_MODEL_ID, DEFAULT_REASONING_EFFORT } from "@openuse/ai";
import { defaultPermissionRecords, normalizeAppName } from "@openuse/permissions";
import type {
  AppSettings,
  ModelCapabilities,
  PermissionLevel,
  PermissionRecord,
  ProviderId,
  ReasoningEffort,
} from "@openuse/shared";

export const SETTINGS_VERSION = 3 as const;
export const DEFAULT_PRIMARY_COLOR = "#c8f36a";
export const DEFAULT_BACKGROUND_BLUR = 18;
export const DEFAULT_BACKGROUND_OPACITY = 0.78;
export const DEFAULT_SHOW_AGENT_CURSOR = true;

export interface PersistedCustomProvider {
  baseUrl: string;
  modelId: string;
  capabilities: ModelCapabilities;
}

export interface PersistedSettings {
  version: typeof SETTINGS_VERSION;
  provider: ProviderId;
  modelId: string;
  permissions: PermissionRecord[];
  reasoningEffort: ReasoningEffort;
  primaryColor: string;
  backgroundBlur: number;
  backgroundOpacity: number;
  showAgentCursor: boolean;
  customProvider: PersistedCustomProvider;
}

const LEGACY_DEFAULT_MODEL_ID = "openai/gpt-5.4";
const REASONING_EFFORTS: ReasoningEffort[] = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"];

export function defaultSettings(): PersistedSettings {
  return {
    version: SETTINGS_VERSION,
    provider: "vercel-gateway",
    modelId: DEFAULT_MODEL_ID,
    permissions: defaultPermissionRecords(),
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    backgroundBlur: DEFAULT_BACKGROUND_BLUR,
    backgroundOpacity: DEFAULT_BACKGROUND_OPACITY,
    showAgentCursor: DEFAULT_SHOW_AGENT_CURSOR,
    customProvider: {
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3.2-vision",
      capabilities: { toolCalling: false, vision: false, reasoning: false },
    },
  };
}

export function clampOpacity(value: number): number {
  return Math.min(1, Math.max(0.45, Number.isFinite(value) ? value : DEFAULT_BACKGROUND_OPACITY));
}

export function clampBlur(value: number): number {
  return Math.min(40, Math.max(0, Number.isFinite(value) ? value : DEFAULT_BACKGROUND_BLUR));
}

export function normalizeHexColor(value: unknown, fallback = DEFAULT_PRIMARY_COLOR): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function safeString(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maxLength) : fallback;
}

function safeUrl(value: unknown, fallback: string): string {
  const candidate = safeString(value, fallback, 500);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString().replace(/\/$/, "") : fallback;
  } catch {
    return fallback;
  }
}

function sanitizeCapabilities(value: unknown): ModelCapabilities {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    toolCalling: record.toolCalling === true,
    vision: record.vision === true,
    reasoning: record.reasoning === true,
  };
}

function sanitizeCustomProvider(value: unknown, fallback: PersistedCustomProvider): PersistedCustomProvider {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    baseUrl: safeUrl(record.baseUrl, fallback.baseUrl),
    modelId: safeString(record.modelId, fallback.modelId, 240),
    capabilities: sanitizeCapabilities(record.capabilities),
  };
}

export class SettingsStore {
  private value: PersistedSettings = defaultSettings();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<Omit<PersistedSettings, "version">> & { version?: number };
      const defaults = defaultSettings();
      const storedModelId = typeof parsed.modelId === "string" && parsed.modelId ? parsed.modelId.slice(0, 240) : undefined;
      const migrateLegacyDefault = parsed.version === 1 && storedModelId === LEGACY_DEFAULT_MODEL_ID;
      this.value = {
        version: SETTINGS_VERSION,
        provider: parsed.provider === "custom-openai-compatible" ? parsed.provider : defaults.provider,
        modelId: migrateLegacyDefault ? defaults.modelId : storedModelId ?? defaults.modelId,
        permissions: Array.isArray(parsed.permissions) ? sanitizePermissions(parsed.permissions) : defaults.permissions,
        reasoningEffort: REASONING_EFFORTS.includes(parsed.reasoningEffort as ReasoningEffort) ? parsed.reasoningEffort as ReasoningEffort : defaults.reasoningEffort,
        primaryColor: normalizeHexColor(parsed.primaryColor, defaults.primaryColor),
        backgroundBlur: clampBlur(typeof parsed.backgroundBlur === "number" ? parsed.backgroundBlur : defaults.backgroundBlur),
        backgroundOpacity: clampOpacity(typeof parsed.backgroundOpacity === "number" ? parsed.backgroundOpacity : defaults.backgroundOpacity),
        showAgentCursor: typeof parsed.showAgentCursor === "boolean" ? parsed.showAgentCursor : defaults.showAgentCursor,
        customProvider: sanitizeCustomProvider(parsed.customProvider, defaults.customProvider),
      };
      if (parsed.version !== SETTINGS_VERSION || migrateLegacyDefault) await this.persist();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await this.persist();
    }
  }

  get persisted(): PersistedSettings {
    return {
      ...this.value,
      permissions: this.value.permissions.map((record) => ({ ...record })),
      customProvider: { ...this.value.customProvider, capabilities: { ...this.value.customProvider.capabilities } },
    };
  }

  async setModel(modelId: string): Promise<void> {
    this.value.modelId = safeString(modelId, this.value.modelId, 240);
    await this.persist();
  }

  async setProvider(provider: ProviderId): Promise<void> {
    this.value.provider = provider === "custom-openai-compatible" ? provider : "vercel-gateway";
    await this.persist();
  }

  async setReasoningEffort(reasoningEffort: ReasoningEffort): Promise<void> {
    this.value.reasoningEffort = REASONING_EFFORTS.includes(reasoningEffort) ? reasoningEffort : "provider-default";
    await this.persist();
  }

  async setAppearance(input: Partial<Pick<PersistedSettings, "primaryColor" | "backgroundBlur" | "backgroundOpacity" | "showAgentCursor">>): Promise<void> {
    if (input.primaryColor !== undefined) this.value.primaryColor = normalizeHexColor(input.primaryColor, this.value.primaryColor);
    if (input.backgroundBlur !== undefined) this.value.backgroundBlur = clampBlur(input.backgroundBlur);
    if (input.backgroundOpacity !== undefined) this.value.backgroundOpacity = clampOpacity(input.backgroundOpacity);
    if (input.showAgentCursor !== undefined) this.value.showAgentCursor = input.showAgentCursor === true;
    await this.persist();
  }

  async setCustomProvider(input: Partial<PersistedCustomProvider>): Promise<void> {
    this.value.customProvider = sanitizeCustomProvider({ ...this.value.customProvider, ...input }, this.value.customProvider);
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

  publicSettings(apiKeyConfigured: boolean, customApiKeyConfigured: boolean): AppSettings {
    return {
      provider: this.value.provider,
      modelId: this.value.modelId,
      apiKeyConfigured,
      permissions: this.value.permissions.map((record) => ({ ...record })),
      reasoningEffort: this.value.reasoningEffort,
      primaryColor: this.value.primaryColor,
      backgroundBlur: this.value.backgroundBlur,
      backgroundOpacity: this.value.backgroundOpacity,
      showAgentCursor: this.value.showAgentCursor,
      customProvider: {
        ...this.value.customProvider,
        apiKeyConfigured: customApiKeyConfigured,
        capabilities: { ...this.value.customProvider.capabilities },
      },
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
    (record): record is PermissionRecord => Boolean(record) && typeof record.appName === "string" && normalizeAppName(record.appName).length > 0 && ["ALLOW", "ASK", "DENY"].includes(record.level),
  ).map((record) => ({
    appName: normalizeAppName(record.appName),
    appIdentity: typeof record.appIdentity === "string" && normalizeAppName(record.appIdentity).length > 0 ? normalizeAppName(record.appIdentity) : undefined,
    level: record.level,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString(),
  }));
  return valid.length > 0 ? valid : defaultPermissionRecords();
}
