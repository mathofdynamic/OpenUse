import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso, type EngineSelfTestResult, type RuntimeEvent } from "@openuse/shared";

interface QualificationRecorderOptions {
  enabled: boolean;
  directory?: string;
  runId?: string;
}

/**
 * Qualification-only, redacted event sink. It deliberately records metadata
 * rather than model messages, screenshots, typed values, or accessibility
 * element values. A recorder failure must not stop the computer runtime.
 */
export class QualificationRecorder {
  readonly enabled: boolean;
  readonly runId: string | undefined;
  readonly directory: string | undefined;
  private readonly eventsPath: string | undefined;
  private writeFailureReported = false;

  constructor(options: QualificationRecorderOptions) {
    this.enabled = options.enabled;
    if (!this.enabled) return;

    this.runId = options.runId ?? `dev-${safeTimestamp()}`;
    this.directory = options.directory ?? join(process.cwd(), ".openuse", "qualification", this.runId);
    this.eventsPath = join(this.directory, "events.jsonl");
    try {
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(join(this.directory, "session.json"), `${JSON.stringify({
        version: 1,
        runId: this.runId,
        mode: "qualification",
        startedAt: nowIso(),
        platform: process.platform,
        pid: process.pid,
        redaction: {
          command: "length only",
          typedText: "omitted",
          screenshots: "omitted",
          accessibilityValues: "omitted from report",
          modelMessages: "omitted",
        },
      }, null, 2)}\n`, "utf8");
    } catch (error) {
      this.reportWriteFailure(error);
    }
  }

  record(event: RuntimeEvent): void {
    if (!this.enabled || !this.eventsPath) return;
    const safeEvent = redactEvent(event);
    if (!safeEvent) return;
    this.write(safeEvent);
  }

  recordSelfTest(result: EngineSelfTestResult): void {
    if (!this.enabled) return;
    this.write({ type: "qualification.self-test", at: nowIso(), result });
  }

  private write(value: unknown): void {
    if (!this.eventsPath) return;
    try {
      appendFileSync(this.eventsPath, `${JSON.stringify(value)}\n`, "utf8");
    } catch (error) {
      this.reportWriteFailure(error);
    }
  }

  private reportWriteFailure(error: unknown): void {
    if (this.writeFailureReported) return;
    this.writeFailureReported = true;
    console.error("OpenUse qualification recorder unavailable:", error instanceof Error ? error.message : "unknown error");
  }
}

function redactEvent(event: RuntimeEvent): unknown {
  switch (event.type) {
    case "task.started":
      return { type: event.type, taskId: event.taskId, modelId: event.modelId, capabilities: event.capabilities, commandLength: event.command.length, at: event.at };
    case "agent.step":
      return { type: event.type, taskId: event.taskId, step: event.step, actionCount: event.actionCount, modelId: event.modelId, at: event.at };
    case "action.started":
      return {
        type: event.type,
        taskId: event.taskId,
        actionId: event.action.actionId,
        tool: event.action.tool,
        risk: event.action.risk,
        targetApp: event.action.targetApp,
        targetWindowId: event.action.targetWindowId,
        targetWindowTitle: event.action.targetWindowTitle,
        targetElementId: event.action.targetElementId,
        retryCount: event.action.retryCount ?? 0,
        at: event.at,
      };
    case "permission.requested":
      return { type: event.type, taskId: event.taskId, requestId: event.request.id, appName: event.request.appName, tool: event.request.tool, risk: event.request.risk, at: event.at };
    case "permission.resolved":
      return { type: event.type, taskId: event.taskId, requestId: event.requestId, decision: event.decision, at: event.at };
    case "model.usage":
      return { type: event.type, taskId: event.taskId, step: event.step, modelId: event.modelId, inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens, at: event.at };
    case "action.completed":
      return { type: event.type, taskId: event.taskId, actionId: event.actionId, durationMs: event.durationMs, telemetry: event.telemetry, at: event.at };
    case "action.failed":
      return { type: event.type, taskId: event.taskId, actionId: event.actionId, code: event.code, durationMs: event.durationMs, telemetry: event.telemetry, at: event.at };
    case "task.finished":
      return { type: event.type, taskId: event.taskId, status: event.status, actionCount: event.actionCount, durationMs: event.durationMs, errorCode: event.errorCode, at: event.at };
    case "engine.status":
      return { type: event.type, status: event.status, at: event.at };
    case "qualification.debug":
      return {
        type: event.type,
        at: event.at,
        debug: {
          taskId: event.debug.taskId,
          step: event.debug.step,
          actionCount: event.debug.actionCount,
          tool: event.debug.tool,
          retryCount: event.debug.retryCount,
          result: event.debug.result,
          errorCode: event.debug.errorCode,
          interactionMethod: event.debug.interactionMethod,
          targetApp: event.debug.targetApp,
          targetWindowId: event.debug.targetWindowId,
          targetWindowTitle: event.debug.targetWindowTitle,
          targetElementId: event.debug.targetElementId,
          window: event.debug.window,
          elementCount: event.debug.elements.length,
          truncated: event.debug.truncated,
          screenshot: event.debug.screenshot,
        },
      };
    case "qualification.self-test":
      return { type: event.type, result: event.result, at: event.at };
  }
}

function safeTimestamp(): string {
  return nowIso().replace(/[:.]/g, "-");
}
