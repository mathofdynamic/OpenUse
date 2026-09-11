import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  ComputerUseAgent,
  actionSummary,
  computerToolSchemas,
  cursorTargetForAction,
  detailForTimeline,
  type AgentRunOptions,
  type ComputerToolInput,
  type ComputerToolName,
  type ToolOutput,
} from "@openuse/agent";
import type { Screenshot, WindowInspection } from "@openuse/computer";
import { OpenUseError, asOpenUseError, nowIso, type ActionTelemetry, type CursorInteraction, type RuntimeEvent } from "@openuse/shared";

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MCP_PROTOCOL_VERSION = "2024-11-05";

type JsonSchema = Record<string, unknown>;

interface McpToolDefinition {
  name: ComputerToolName;
  description: string;
  inputSchema: JsonSchema;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface McpServerOptions {
  taskId: string;
  command: string;
  modelId: string;
  maxActions?: number;
  abortSignal: AbortSignal;
  agent: ComputerUseAgent;
  onEvent(event: RuntimeEvent): void;
}

export interface McpBridgeHandle {
  url: string;
  bearerToken: string;
  completedSummary?: string;
  actionCount: number;
  close(): Promise<void>;
}

const emptySchema: JsonSchema = { type: "object", properties: {}, additionalProperties: false };
const stringSchema = (maxLength: number): JsonSchema => ({ type: "string", minLength: 1, maxLength });
const numberSchema = (minimum: number, maximum: number): JsonSchema => ({ type: "number", minimum, maximum });

const toolDefinitions: McpToolDefinition[] = [
  { name: "computer_list_apps", description: "List the visible desktop applications. Use this before launching an uncertain app.", inputSchema: emptySchema },
  { name: "computer_list_windows", description: "List current top-level application windows with stable window IDs, titles, and app identities.", inputSchema: emptySchema },
  { name: "computer_inspect_window", description: "Inspect one window and return a small semantic accessibility tree. Prefer this before clicking.", inputSchema: { type: "object", properties: { windowId: stringSchema(160) }, required: ["windowId"], additionalProperties: false } },
  { name: "computer_capture_screen", description: "Capture one reduced screenshot when semantic state is insufficient. Do not call continuously.", inputSchema: { type: "object", properties: { windowId: stringSchema(160) }, additionalProperties: false } },
  { name: "computer_launch_app", description: "Launch a named desktop application. The runtime applies its own app permission policy.", inputSchema: { type: "object", properties: { app: stringSchema(160), arguments: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 12 } }, required: ["app"], additionalProperties: false } },
  { name: "computer_focus_window", description: "Focus a window by the ID returned by listWindows.", inputSchema: { type: "object", properties: { windowId: stringSchema(160) }, required: ["windowId"], additionalProperties: false } },
  { name: "computer_click", description: "Click screen coordinates only when semantic element interaction is unavailable.", inputSchema: { type: "object", properties: { x: numberSchema(-20_000, 20_000), y: numberSchema(-20_000, 20_000), button: { type: "string", enum: ["left", "right", "middle"] } }, required: ["x", "y"], additionalProperties: false } },
  { name: "computer_click_element", description: "Click a fresh semantic UI element by role/name/automation ID, using its native pattern first.", inputSchema: { type: "object", properties: { windowId: stringSchema(160), elementId: stringSchema(160), role: stringSchema(80), name: stringSchema(240), automationId: stringSchema(240), className: stringSchema(240) }, required: ["windowId"], additionalProperties: false } },
  { name: "computer_double_click", description: "Double-click screen coordinates as a last-resort interaction.", inputSchema: { type: "object", properties: { x: numberSchema(-20_000, 20_000), y: numberSchema(-20_000, 20_000) }, required: ["x", "y"], additionalProperties: false } },
  { name: "computer_type_text", description: "Type text into the focused or target window. Never use this for passwords or credentials.", inputSchema: { type: "object", properties: { text: stringSchema(20_000), windowId: stringSchema(160), elementId: stringSchema(160), role: stringSchema(80), name: stringSchema(240), automationId: stringSchema(240), className: stringSchema(240) }, required: ["text"], additionalProperties: false } },
  { name: "computer_press_key", description: "Press one named key or a safe chord such as CMD+S, CTRL+S, ENTER, TAB, or ESCAPE.", inputSchema: { type: "object", properties: { key: stringSchema(80) }, required: ["key"], additionalProperties: false } },
  { name: "computer_scroll", description: "Scroll the focused application by a bounded amount.", inputSchema: { type: "object", properties: { amount: { type: "integer", minimum: -20, maximum: 20 }, x: numberSchema(-20_000, 20_000), y: numberSchema(-20_000, 20_000) }, required: ["amount"], additionalProperties: false } },
  { name: "computer_wait", description: "Wait briefly for a desktop UI transition to settle.", inputSchema: { type: "object", properties: { milliseconds: { type: "integer", minimum: 50, maximum: 10_000 } }, required: ["milliseconds"], additionalProperties: false } },
  { name: "computer_finish", description: "Use this when the user task is complete and the final state has been verified.", inputSchema: { type: "object", properties: { summary: stringSchema(800) }, required: ["summary"], additionalProperties: false } },
];

const toolDefinitionMap = new Map(toolDefinitions.map((definition) => [definition.name, definition]));

export class OpenUseMcpBridge {
  private server: Server | undefined;
  private bearerToken = randomBytes(32).toString("hex");
  private port = 0;
  private closed = false;
  private lastInspection: WindowInspection | undefined;
  private lastScreenshot: Screenshot | undefined;
  private finishedSummary: string | undefined;
  private actionTotal = 0;
  private readonly maxActions: number;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: McpServerOptions) {
    this.maxActions = options.maxActions ?? 30;
  }

  get actionCount(): number { return this.actionTotal; }
  get completedSummary(): string | undefined { return this.finishedSummary; }

  async start(): Promise<McpBridgeHandle> {
    if (this.server) throw new OpenUseError("IPC_ERROR", "The OpenUse tool bridge has already started.");
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      const server = this.server!;
      const onError = (error: Error) => { server.removeListener("listening", onListening); reject(error); };
      const onListening = () => { server.removeListener("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(0, "127.0.0.1");
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new OpenUseError("IPC_ERROR", "The OpenUse tool bridge did not receive a local port.");
    this.port = address.port;
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  snapshot(): McpBridgeHandle {
    return {
      url: `http://127.0.0.1:${this.port}/mcp`,
      bearerToken: this.bearerToken,
      completedSummary: this.finishedSummary,
      actionCount: this.actionTotal,
      close: () => this.close(),
    };
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.writeHead(request.method === "OPTIONS" ? 204 : 405, { Allow: "POST, OPTIONS" });
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.bearerToken}`) {
      this.send(response, 401, { error: "Unauthorized" });
      return;
    }
    try {
      const body = await readBody(request);
      const parsed = JSON.parse(body) as unknown;
      if (Array.isArray(parsed)) {
        const results = [];
        for (const item of parsed) results.push(await this.handleRpc(item));
        this.send(response, 200, results.filter((item): item is Record<string, unknown> => Boolean(item)));
        return;
      }
      const result = await this.handleRpc(parsed);
      if (!result) {
        response.writeHead(202);
        response.end();
        return;
      }
      this.send(response, 200, result);
    } catch (error) {
      const openUseError = asOpenUseError(error, "IPC_ERROR");
      this.send(response, 200, { jsonrpc: "2.0", id: null, error: { code: -32000, message: openUseError.message } });
    }
  }

  private async handleRpc(raw: unknown): Promise<Record<string, unknown> | undefined> {
    const request = raw && typeof raw === "object" ? raw as JsonRpcRequest : {};
    const id = request.id ?? null;
    const method = request.method;
    if (!method) return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid JSON-RPC request." } };
    if (request.id === undefined || method.startsWith("notifications/")) {
      if (method === "notifications/initialized" || method === "notifications/cancelled") return undefined;
      if (method === "notifications/progress") return undefined;
    }
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "openuse-computer-control", version: "0.2.0" },
            instructions: "Use only the listed OpenUse computer_* tools. OpenUse owns permissions, safety checks, screenshots, and cancellation.",
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: toolDefinitions } };
      case "tools/call":
        return { jsonrpc: "2.0", id, result: await this.callTool(request.params) };
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported MCP method ${method}.` } };
    }
  }

  private async callTool(params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    const rawName = typeof params?.name === "string" ? params.name : "";
    const toolName = canonicalToolName(rawName);
    const definition = toolDefinitionMap.get(toolName);
    if (!definition) return { isError: true, content: [{ type: "text", text: "OpenUse does not expose that tool." }] };
    if (this.options.abortSignal.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
    if (this.actionTotal >= this.maxActions) return { isError: true, content: [{ type: "text", text: `The task reached OpenUse's ${this.maxActions}-action safety limit.` }] };

    const schema = computerToolSchemas[toolName];
    const parsedInput = schema.safeParse(params?.arguments ?? {});
    const input = parsedInput.success ? parsedInput.data : undefined;
    const actionId = `${this.options.taskId}-action-${this.actionTotal + 1}`;
    const target = cursorTargetForAction(toolName, input, this.lastInspection);
    this.actionTotal += 1;
    if (target) this.options.onEvent({ type: "cursor", taskId: this.options.taskId, interaction: cursorInteractionForTool(toolName), target, at: nowIso() });
    this.options.onEvent({
      type: "action.started",
      taskId: this.options.taskId,
      action: { actionId, tool: toolName, summary: actionSummary(toolName, input), status: "running", retryCount: 0 },
      at: nowIso(),
    });
    const startedAt = Date.now();
    try {
      if (!parsedInput.success) throw new OpenUseError("INVALID_TOOL_INPUT", `The ${toolName} input did not pass validation.`);
      const execution = await this.options.agent.executeComputerTool(
        toolName,
        input as ComputerToolInput[typeof toolName],
        this.agentOptions(),
        this.lastScreenshot,
      );
      this.lastInspection = execution.observation ?? this.lastInspection;
      if (execution.screenshot) this.lastScreenshot = execution.screenshot;
      const durationMs = Date.now() - startedAt;
      const telemetry = execution.telemetry ? { ...execution.telemetry, retryCount: 0 } : undefined;
      const cursorTarget = execution.telemetry?.targetPoint
        ? { point: execution.telemetry.targetPoint, bounds: execution.telemetry.targetBounds, display: execution.telemetry.display, coordinateSystem: execution.telemetry.coordinateSystem ?? "unknown" }
        : undefined;
      if (cursorTarget) this.options.onEvent({ type: "cursor", taskId: this.options.taskId, interaction: cursorInteractionForTool(toolName), target: cursorTarget, at: nowIso() });
      const detail = detailForTimeline(toolName, execution.output);
      this.options.onEvent({ type: "action.completed", taskId: this.options.taskId, actionId, durationMs, detail, telemetry, at: nowIso() });
      if (toolName === "computer_finish") this.finishedSummary = String((input as { summary: string }).summary);
      return outputToMcp(execution.output);
    } catch (error) {
      const openUseError = asOpenUseError(error, "UNSUPPORTED_ACTION");
      const durationMs = Date.now() - startedAt;
      const telemetry: ActionTelemetry = { retryCount: 0 };
      this.options.onEvent({ type: "action.failed", taskId: this.options.taskId, actionId, code: openUseError.code, message: openUseError.message, durationMs, telemetry, at: nowIso() });
      if (openUseError.code === "TASK_CANCELLED") throw openUseError;
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: openUseError.code, message: openUseError.message } }) }] };
    }
  }

  private agentOptions(): AgentRunOptions {
    return {
      taskId: this.options.taskId,
      command: this.options.command,
      modelId: this.options.modelId,
      abortSignal: this.options.abortSignal,
      onEvent: this.options.onEvent,
    };
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" });
    response.end(JSON.stringify(body));
  }
}

function canonicalToolName(value: string): ComputerToolName {
  const candidates = [
    value,
    value.replace(/^mcp__openuse__/, ""),
    value.replace(/^openuse__/, ""),
    value.replace(/^openuse_/, ""),
  ];
  return candidates.find((candidate): candidate is ComputerToolName => toolDefinitionMap.has(candidate as ComputerToolName)) ?? value as ComputerToolName;
}

function cursorInteractionForTool(toolName: ComputerToolName): CursorInteraction {
  switch (toolName) {
    case "computer_double_click": return "double-click";
    case "computer_click":
    case "computer_click_element": return "click";
    case "computer_type_text": return "typing";
    case "computer_scroll": return "scroll";
    case "computer_wait": return "waiting";
    default: return "move";
  }
}

function outputToMcp(output: ToolOutput): Record<string, unknown> {
  if (output.type === "json") {
    return { isError: false, content: [{ type: "text", text: JSON.stringify(output.value) }] };
  }
  return {
    isError: false,
    content: output.value.map((part) => part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image", data: part.data.data, mimeType: part.mediaType }),
  };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new OpenUseError("IPC_ERROR", "The MCP request is too large."));
        request.destroy();
        return;
      }
      chunks.push(value);
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}
