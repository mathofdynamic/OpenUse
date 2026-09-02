import {
  OpenUseError,
  type ActionRisk,
  type PermissionDecision,
  type PermissionLevel,
  type PermissionRecord,
  type PermissionRequest,
} from "@openuse/shared";

export interface PermissionStore {
  get(appName: string, appIdentity?: string): PermissionLevel | undefined;
  set(appName: string, level: PermissionLevel, appIdentity?: string): Promise<void> | void;
  records(): PermissionRecord[];
}

export interface PermissionPrompt {
  request(input: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision>;
}

export interface AuthorizationInput {
  appName: string;
  appIdentity?: string;
  tool: string;
  actionSummary: string;
  risk: ActionRisk;
  reason: string;
}

const DEFAULT_PERMISSION_LEVELS: Array<Pick<PermissionRecord, "appName" | "level">> = [
  { appName: "Notepad", level: "ALLOW" },
  { appName: "Calculator", level: "ALLOW" },
  { appName: "Explorer", level: "ASK" },
  { appName: "Chrome", level: "ASK" },
  { appName: "Password Manager", level: "DENY" },
];

export function normalizeAppName(value: string): string {
  return value.trim().replace(/\.exe$/i, "").replace(/\s+/g, " ");
}

export function defaultPermissionRecords(): PermissionRecord[] {
  const updatedAt = new Date().toISOString();
  return DEFAULT_PERMISSION_LEVELS.map((record) => ({ ...record, updatedAt }));
}

export class InMemoryPermissionStore implements PermissionStore {
  private readonly values = new Map<string, PermissionRecord>();

  constructor(records: PermissionRecord[] = defaultPermissionRecords()) {
    for (const record of records) {
      const appName = normalizeAppName(record.appName);
      const appIdentity = record.appIdentity ? normalizeAppName(record.appIdentity) : undefined;
      this.values.set(permissionKey(appIdentity ?? appName), { ...record, appName, appIdentity });
    }
  }

  get(appName: string, appIdentity?: string): PermissionLevel | undefined {
    const displayKey = permissionKey(appName);
    const identityKey = appIdentity ? permissionKey(appIdentity) : undefined;
    return (identityKey ? this.values.get(identityKey) : undefined)?.level ?? this.values.get(displayKey)?.level;
  }

  set(appName: string, level: PermissionLevel, appIdentity?: string): void {
    const normalized = normalizeAppName(appName);
    const normalizedIdentity = appIdentity ? normalizeAppName(appIdentity) : undefined;
    const existing = normalizedIdentity
      ? undefined
      : [...this.values.values()].find((record) => record.appName.toLowerCase() === normalized.toLowerCase());
    const effectiveIdentity = normalizedIdentity ?? existing?.appIdentity;
    this.values.set(permissionKey(effectiveIdentity ?? normalized), {
      appName: normalized,
      appIdentity: effectiveIdentity,
      level,
      updatedAt: new Date().toISOString(),
    });
  }

  records(): PermissionRecord[] {
    return [...this.values.values()].sort((a, b) => a.appName.localeCompare(b.appName));
  }
}

export interface RiskContext {
  appName?: string;
  role?: string;
  name?: string;
  key?: string;
}

const DESTRUCTIVE_WORDS = /\b(delete|remove|uninstall|format|erase|empty|discard|overwrite)\b/i;
const EXTERNAL_SUBMISSION_WORDS = /\b(submit|send|purchase|buy|checkout|install|grant|allow access|change permission)\b/i;
const CREDENTIAL_WORDS = /\b(password|passcode|credential|secret|security code|one[- ]time code|otp)\b/i;
const SYSTEM_SETTINGS_WORDS = /\b(settings|control panel|registry|regedit|device manager)\b/i;
const CREDENTIAL_APP_WORDS = /(?:password manager|1password|bitwarden|lastpass|keepass|dashlane)/i;

export function classifyActionRisk(tool: string, context: RiskContext = {}): ActionRisk {
  const target = [context.appName, context.role, context.name, context.key].filter(Boolean).join(" ");
  if (CREDENTIAL_APP_WORDS.test(context.appName ?? "")) return "sensitive";
  if (CREDENTIAL_WORDS.test(target)) return "sensitive";
  if (DESTRUCTIVE_WORDS.test(target)) return "destructive";
  if (EXTERNAL_SUBMISSION_WORDS.test(target)) return "sensitive";
  if (SYSTEM_SETTINGS_WORDS.test(context.appName ?? "")) return "sensitive";
  if (tool.includes("list") || tool.includes("inspect") || tool.includes("capture")) return "read";
  if (tool.includes("wait")) return "read";
  return "interaction";
}

export class PermissionEngine {
  private readonly sessionAllowed = new Set<string>();

  constructor(
    private readonly store: PermissionStore,
    private readonly prompt: PermissionPrompt,
  ) {}

  records(): PermissionRecord[] {
    return this.store.records();
  }

  async authorize(input: AuthorizationInput, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
    const appName = normalizeAppName(input.appName || "Unknown application");
    const appIdentity = normalizeAppName(input.appIdentity || appName);
    const key = permissionKey(appIdentity);
    const displayKey = permissionKey(appName);
    const existing = this.store.get(appName, appIdentity);
    const mustAskForRisk = input.risk === "sensitive" || input.risk === "destructive";

    if (CREDENTIAL_APP_WORDS.test(appName)) {
      throw new OpenUseError("APP_NOT_ALLOWED", `${appName} is blocked in this MVP.`);
    }

    if (!mustAskForRisk && existing === "DENY") {
      throw new OpenUseError("APP_NOT_ALLOWED", `${appName} is not allowed to be controlled.`);
    }
    if (!mustAskForRisk && (existing === "ALLOW" || this.sessionAllowed.has(key) || this.sessionAllowed.has(displayKey))) return;
    if (existing === "DENY") {
      throw new OpenUseError("APP_NOT_ALLOWED", `${appName} is denied by OpenUse permissions.`);
    }

    const request: PermissionRequest = {
      id: crypto.randomUUID(),
      appName,
      appIdentity,
      tool: input.tool,
      actionSummary: input.actionSummary,
      risk: input.risk,
      reason: input.reason,
    };
    const decision = await this.prompt.request(request, signal);
    if (decision === "deny") {
      throw new OpenUseError("USER_DENIED", `You denied control of ${appName}.`);
    }
    if (decision === "allow-once") {
      if (!mustAskForRisk) {
        this.sessionAllowed.add(key);
        this.sessionAllowed.add(displayKey);
      }
      return;
    }
    if (decision === "always-allow") {
      if (mustAskForRisk) return;
      await this.store.set(appName, "ALLOW", appIdentity);
      this.sessionAllowed.add(key);
      this.sessionAllowed.add(displayKey);
    }
  }
}

function permissionKey(value: string): string {
  return normalizeAppName(value).toLowerCase();
}

export function isCredentialTarget(role?: string, name?: string): boolean {
  return CREDENTIAL_WORDS.test([role, name].filter(Boolean).join(" "));
}
