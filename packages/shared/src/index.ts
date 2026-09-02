export type ProviderId = "vercel-gateway";

export interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  reasoning?: boolean;
}

export interface ModelDefinition {
  id: string;
  label: string;
  provider: ProviderId;
  capabilities: ModelCapabilities;
}

export type AgentStatus = "idle" | "running" | "completed" | "stopped" | "error";

export type ActionRisk = "read" | "interaction" | "sensitive" | "destructive";

export type PermissionLevel = "ALLOW" | "ASK" | "DENY";

export type PermissionDecision = "allow-once" | "always-allow" | "deny";

export interface PermissionRecord {
  appName: string;
  appIdentity?: string;
  level: PermissionLevel;
  updatedAt: string;
}

export interface PermissionRequest {
  id: string;
  appName: string;
  appIdentity: string;
  tool: string;
  actionSummary: string;
  risk: ActionRisk;
  reason: string;
}

export interface EngineStatus {
  platform: string;
  state: "ready" | "starting" | "offline" | "unsupported" | "stopped";
  detail: string;
}

export interface AppSettings {
  provider: ProviderId;
  modelId: string;
  apiKeyConfigured: boolean;
  permissions: PermissionRecord[];
}

export interface AppSnapshot {
  settings: AppSettings;
  engine: EngineStatus;
}

export interface TimelineAction {
  actionId: string;
  tool: string;
  summary: string;
  appName?: string;
  status: "pending" | "running" | "completed" | "failed";
  risk?: ActionRisk;
  durationMs?: number;
  errorCode?: OpenUseErrorCode;
  errorMessage?: string;
  detail?: string;
}

export type RuntimeEvent =
  | {
      type: "task.started";
      taskId: string;
      command: string;
      modelId: string;
      at: string;
    }
  | {
      type: "agent.step";
      taskId: string;
      step: number;
      actionCount: number;
      modelId: string;
      at: string;
    }
  | {
      type: "action.started";
      taskId: string;
      action: TimelineAction;
      at: string;
    }
  | {
      type: "permission.requested";
      taskId: string;
      request: PermissionRequest;
      at: string;
    }
  | {
      type: "permission.resolved";
      taskId: string;
      requestId: string;
      decision: PermissionDecision;
      at: string;
    }
  | {
      type: "model.usage";
      taskId: string;
      step: number;
      modelId: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      at: string;
    }
  | {
      type: "action.completed";
      taskId: string;
      actionId: string;
      durationMs: number;
      detail?: string;
      at: string;
    }
  | {
      type: "action.failed";
      taskId: string;
      actionId: string;
      code: OpenUseErrorCode;
      message: string;
      at: string;
    }
  | {
      type: "task.finished";
      taskId: string;
      status: "completed" | "stopped" | "error";
      summary: string;
      actionCount: number;
      durationMs: number;
      errorCode?: OpenUseErrorCode;
      at: string;
    }
  | {
      type: "engine.status";
      status: EngineStatus;
      at: string;
    };

export type OpenUseErrorCode =
  | "WINDOW_NOT_FOUND"
  | "ELEMENT_NOT_FOUND"
  | "APP_NOT_ALLOWED"
  | "USER_DENIED"
  | "ACTION_TIMEOUT"
  | "MODEL_UNSUPPORTED"
  | "MODEL_FAILED"
  | "NATIVE_ENGINE_OFFLINE"
  | "STALE_UI_STATE"
  | "TASK_CANCELLED"
  | "MAX_ACTIONS_REACHED"
  | "INVALID_TOOL_INPUT"
  | "CREDENTIAL_INTERACTION_DISABLED"
  | "UNSUPPORTED_ACTION"
  | "IPC_ERROR";

export class OpenUseError extends Error {
  readonly code: OpenUseErrorCode;
  readonly cause?: unknown;

  constructor(code: OpenUseErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "OpenUseError";
    this.code = code;
    this.cause = cause;
  }
}

export function asOpenUseError(error: unknown, fallbackCode: OpenUseErrorCode): OpenUseError {
  if (error instanceof OpenUseError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new OpenUseError("TASK_CANCELLED", "The task was stopped.", error);
  }
  if (error instanceof Error) {
    return new OpenUseError(fallbackCode, error.message, error);
  }
  return new OpenUseError(fallbackCode, "An unknown OpenUse error occurred.", error);
}

export function redactText(text: string): string {
  return `[redacted ${text.length} chars]`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
