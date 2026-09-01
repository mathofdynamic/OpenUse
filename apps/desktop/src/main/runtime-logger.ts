import type { RuntimeEvent } from "@openuse/shared";

/** Development-only event logging with user content deliberately omitted. */
export function logRuntimeEvent(event: RuntimeEvent, enabled: boolean): void {
  if (!enabled) return;
  const safeEvent = (() => {
    switch (event.type) {
      case "task.started":
        return { type: event.type, taskId: event.taskId, modelId: event.modelId };
      case "agent.step":
        return { type: event.type, taskId: event.taskId, step: event.step, actionCount: event.actionCount, modelId: event.modelId };
      case "action.started":
        return { type: event.type, taskId: event.taskId, actionId: event.action.actionId, tool: event.action.tool, risk: event.action.risk };
      case "permission.requested":
        return { type: event.type, taskId: event.taskId, requestId: event.request.id, appName: event.request.appName, tool: event.request.tool, risk: event.request.risk };
      case "permission.resolved":
        return { type: event.type, taskId: event.taskId, requestId: event.requestId, decision: event.decision };
      case "model.usage":
        return { type: event.type, taskId: event.taskId, step: event.step, modelId: event.modelId, inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens };
      case "action.completed":
        return { type: event.type, taskId: event.taskId, actionId: event.actionId, durationMs: event.durationMs };
      case "action.failed":
        return { type: event.type, taskId: event.taskId, actionId: event.actionId, code: event.code };
      case "task.finished":
        return { type: event.type, taskId: event.taskId, status: event.status, actionCount: event.actionCount, durationMs: event.durationMs, errorCode: event.errorCode };
      case "engine.status":
        return { type: event.type, platform: event.status.platform, state: event.status.state };
    }
  })();
  console.debug(`[openuse] ${JSON.stringify(safeEvent)}`);
}
