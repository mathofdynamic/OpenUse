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

export type InteractionMethod =
  | "accessibility-native"
  | "element-coordinate"
  | "vision-coordinate"
  | "coordinate-input"
  | "keyboard-input";

export interface ActionTelemetry {
  interactionMethod?: InteractionMethod;
  targetApp?: string;
  targetWindowId?: string;
  targetWindowTitle?: string;
  targetElementId?: string;
  retryCount: number;
}

export interface QualificationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface QualificationWindowSnapshot {
  id: string;
  title: string;
  app: string;
  appIdentity: string;
  processName: string;
  processId: number;
  className: string;
  bounds: QualificationBounds;
  focused: boolean;
}

export interface QualificationElementSnapshot {
  id: string;
  parentId?: string;
  role: string;
  subrole?: string;
  name: string;
  automationId?: string;
  className: string;
  bounds: QualificationBounds;
  enabled: boolean;
  offscreen: boolean;
  focused?: boolean;
  supportedPatterns: string[];
  value?: string;
}

export interface QualificationScreenshotSnapshot {
  width: number;
  height: number;
  originX: number;
  originY: number;
  captureWidth: number;
  captureHeight: number;
  dpi: number;
  scaleFactor?: number;
  coordinateSystem: string;
}

export interface QualificationDebugSnapshot {
  taskId: string;
  step: number;
  actionCount: number;
  tool: string;
  retryCount: number;
  result: "success" | "failure";
  errorCode?: OpenUseErrorCode;
  interactionMethod?: InteractionMethod;
  targetApp?: string;
  targetWindowId?: string;
  targetWindowTitle?: string;
  targetElementId?: string;
  window?: QualificationWindowSnapshot;
  elements: QualificationElementSnapshot[];
  truncated?: boolean;
  screenshot?: QualificationScreenshotSnapshot;
  detail?: string;
}

export interface MonitorDiagnostics {
  index: number;
  bounds: QualificationBounds;
  workArea: QualificationBounds;
  dpi: number;
  scaleFactor?: number;
  primary: boolean;
}

export interface SelfTestScreenshotDiagnostics {
  width: number;
  height: number;
  dpi: number;
  scaleFactor?: number;
  coordinateSystem: string;
  captureBounds: QualificationBounds;
}

export interface EngineSelfTestResult {
  ok: boolean;
  uiAutomationAvailable: boolean;
  windowEnumerationAvailable: boolean;
  screenEnumerationAvailable: boolean;
  screenshotAvailable: boolean;
  dpiAvailable: boolean;
  inputApisAvailable: boolean;
  monitorCount: number;
  monitors: MonitorDiagnostics[];
  platform?: string;
  accessibilityPermission?: "granted" | "denied" | "unknown";
  screenRecordingPermission?: "granted" | "denied" | "unknown";
  screenshot?: SelfTestScreenshotDiagnostics;
  detail?: string;
}

export interface QualificationSessionInfo {
  enabled: boolean;
  runId?: string;
  selfTest?: EngineSelfTestResult;
}

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
  canStart?: boolean;
  pid?: number;
  protocol?: string;
  lastHeartbeatAt?: string;
  lastAction?: string;
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
  qualification: QualificationSessionInfo;
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
  interactionMethod?: InteractionMethod;
  targetApp?: string;
  targetWindowId?: string;
  targetWindowTitle?: string;
  targetElementId?: string;
  retryCount?: number;
}

export type RuntimeEvent =
  | {
      type: "task.started";
      taskId: string;
      command: string;
      modelId: string;
      capabilities: ModelCapabilities;
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
      telemetry?: ActionTelemetry;
      at: string;
    }
  | {
      type: "action.failed";
      taskId: string;
      actionId: string;
      code: OpenUseErrorCode;
      message: string;
      durationMs: number;
      telemetry?: ActionTelemetry;
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
    }
  | {
      type: "qualification.debug";
      debug: QualificationDebugSnapshot;
      at: string;
    }
  | {
      type: "qualification.self-test";
      result: EngineSelfTestResult;
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
  | "ACCESSIBILITY_PERMISSION_REQUIRED"
  | "SCREEN_RECORDING_PERMISSION_REQUIRED"
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
