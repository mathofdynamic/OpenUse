import type { RuntimeEvent } from "@openuse/shared";

/** Development-only event logging with user content deliberately omitted. */
export function logRuntimeEvent(event: RuntimeEvent, enabled: boolean): void {
  if (!enabled) return;
  const safeEvent = (() => {
    switch (event.type) {
      case "task.started":
        return { type: event.type, taskId: event.taskId, modelId: event.modelId, capabilities: event.capabilities };
      case "agent.step":
        return { type: event.type, taskId: event.taskId, step: event.step, actionCount: event.actionCount, modelId: event.modelId };
      case "action.started":
        return { type: event.type, taskId: event.taskId, actionId: event.action.actionId, tool: event.action.tool, risk: event.action.risk, retryCount: event.action.retryCount };
      case "permission.requested":
        return { type: event.type, taskId: event.taskId, requestId: event.request.id, appName: event.request.appName, tool: event.request.tool, risk: event.request.risk };
      case "permission.resolved":
        return { type: event.type, taskId: event.taskId, requestId: event.requestId, decision: event.decision };
      case "model.usage":
        return { type: event.type, taskId: event.taskId, step: event.step, modelId: event.modelId, inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalTokens: event.totalTokens };
      case "action.completed":
        return { type: event.type, taskId: event.taskId, actionId: event.actionId, durationMs: event.durationMs, interactionMethod: event.telemetry?.interactionMethod, retryCount: event.telemetry?.retryCount };
      case "action.failed":
        return { type: event.type, taskId: event.taskId, actionId: event.actionId, code: event.code, durationMs: event.durationMs, retryCount: event.telemetry?.retryCount };
      case "task.finished":
        return { type: event.type, taskId: event.taskId, status: event.status, actionCount: event.actionCount, durationMs: event.durationMs, errorCode: event.errorCode };
      case "engine.status":
        return { type: event.type, platform: event.status.platform, state: event.status.state, pid: event.status.pid, protocol: event.status.protocol, lastAction: event.status.lastAction };
      case "qualification.debug":
        return { type: event.type, taskId: event.debug.taskId, tool: event.debug.tool, result: event.debug.result, interactionMethod: event.debug.interactionMethod, elementCount: event.debug.elements.length };
      case "qualification.self-test":
        return { type: event.type, ok: event.result.ok, monitorCount: event.result.monitorCount };
    }
  })();
  console.debug(`[openuse] ${JSON.stringify(safeEvent)}`);
}
