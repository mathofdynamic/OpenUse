import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nativeResponseSchema, type NativeMethod, type NativeMethodParams, type NativeMethodResult } from "@openuse/protocol";
import { OpenUseError, nowIso, type EngineStatus } from "@openuse/shared";
import type { ComputerRpc } from "@openuse/computer";

interface NativeProcessOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: NodeJS.Timeout;
  cleanup(): void;
}

export class NativeEngineProcess implements ComputerRpc {
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private hasAttemptedStart = false;
  private processState: EngineStatus["state"];
  private lastHeartbeatAt: string | undefined;
  private lastAction: string | undefined;

  constructor(private readonly options: NativeProcessOptions) {
    this.processState = options.platform === "win32" ? "offline" : "unsupported";
  }

  get status(): EngineStatus {
    if (this.options.platform !== "win32") {
      return { platform: this.options.platform, state: "unsupported", detail: "OpenUse controls Windows only.", canStart: false };
    }
    if (this.child && !this.child.killed) {
      return {
        platform: this.options.platform,
        state: this.processState === "starting" ? "starting" : "ready",
        detail: this.processState === "starting" ? "Starting the Windows sidecar." : "Windows sidecar connected.",
        canStart: true,
        pid: this.child.pid ?? undefined,
        protocol: "json-lines/v1",
        lastHeartbeatAt: this.lastHeartbeatAt,
        lastAction: this.lastAction,
      };
    }
    const enginePath = this.resolveEnginePath();
    const available = Boolean(enginePath && existsSync(enginePath));
    const state = this.processState === "stopped"
      ? "stopped"
      : this.hasAttemptedStart && this.processState === "offline"
        ? "offline"
        : available
          ? "ready"
          : "offline";
    return {
      platform: this.options.platform,
      state,
      detail: state === "offline" && this.hasAttemptedStart
        ? "The Windows sidecar is offline; it will be restarted on the next action."
        : available
        ? "Windows sidecar is ready to start."
        : "Publish the Windows sidecar with pnpm native:build.",
      canStart: available && state !== "stopped",
      protocol: "json-lines/v1",
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastAction: this.lastAction,
    };
  }

  async selfTest(signal?: AbortSignal) {
    return this.request("selfTest", {}, signal);
  }

  async request<M extends NativeMethod>(
    method: M,
    params: NativeMethodParams[M],
    signal?: AbortSignal,
  ): Promise<NativeMethodResult[M]> {
    if (this.options.platform !== "win32") {
      throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows computer engine is unavailable on this host.");
    }
    if (signal?.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
    await this.ensureStarted(signal);
    if (signal?.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
    const child = this.child;
    if (!child?.stdin.writable) throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar is offline.");
    const id = `native-${++this.sequence}`;
    this.lastAction = method;
    const payload = `${JSON.stringify({ id, method, params })}\n`;
    return new Promise<NativeMethodResult[M]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        pending.cleanup();
        reject(new OpenUseError("ACTION_TIMEOUT", `The native action ${method} timed out.`));
      }, 30_000);
      let abort = () => undefined;
      const pending: PendingRequest = {
        resolve: (value) => resolve(value as NativeMethodResult[M]),
        reject,
        timer,
        cleanup: () => signal?.removeEventListener("abort", abort),
      };
      this.pending.set(id, pending);
      abort = () => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        this.sendCancel(child, id);
        pending.cleanup();
        reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      try {
        child.stdin.write(payload, "utf8", (error) => {
          if (!error) return;
          if (!this.pending.delete(id)) return;
          clearTimeout(timer);
          pending.cleanup();
          reject(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar could not receive the action.", error));
        });
      } catch (error) {
        abort();
        reject(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar could not receive the action.", error));
      }
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child && !child.killed && this.processState === "starting") {
      this.lines?.close();
      this.lines = undefined;
      this.child = undefined;
      this.processState = "offline";
      child.kill();
      return;
    }
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.cleanup();
      this.sendCancel(child, id);
      request.reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
      this.pending.delete(id);
    }
    if (child && !child.killed) {
      // The sidecar has its own cancellation queue. Keep the process and its
      // STA worker alive so a new task can start without a process restart.
      this.processState = "ready";
    } else {
      this.processState = "offline";
    }
  }

  async shutdown(): Promise<void> {
    await this.stop();
    this.lines?.close();
    this.lines = undefined;
    const child = this.child;
    this.child = undefined;
    this.processState = "stopped";
    if (child && !child.killed) child.kill();
  }

  private async ensureStarted(signal?: AbortSignal): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (signal?.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
    const enginePath = this.resolveEnginePath();
    if (!enginePath || !existsSync(enginePath)) {
      throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar executable is not available.");
    }
    this.hasAttemptedStart = true;
    this.processState = "starting";
    const child = spawn(enginePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", () => undefined);
    let started = false;
    const startup = new Promise<void>((resolve, reject) => {
      child.once("spawn", () => {
        started = true;
        resolve();
      });
      child.on("error", (error) => {
        if (!started) reject(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar could not start.", error));
        this.handleProcessExit(child, error);
      });
      child.once("exit", (code) => {
        if (!started) reject(new OpenUseError("NATIVE_ENGINE_OFFLINE", `The Windows sidecar exited during startup (${code ?? "unknown"}).`));
        this.handleProcessExit(child);
      });
    });
    let removeAbortListener: () => void = () => undefined;
    const cancelled = signal
      ? new Promise<never>((_, reject) => {
          const abort = () => reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
          if (signal.aborted) {
            abort();
            return;
          }
          signal.addEventListener("abort", abort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", abort);
        })
      : undefined;
    try {
      await (cancelled ? Promise.race([startup, cancelled]) : startup);
    } finally {
      removeAbortListener();
    }
    if (this.child !== child) throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar stopped while starting.");
    this.processState = "ready";
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.handleProtocolFailure(new OpenUseError("IPC_ERROR", "The Windows sidecar returned malformed JSON."));
      return;
    }
    const response = nativeResponseSchema.safeParse(parsed);
    if (!response.success) {
      this.handleProtocolFailure(new OpenUseError("IPC_ERROR", "The Windows sidecar returned an invalid response."));
      return;
    }
    this.lastHeartbeatAt = nowIso();
    const pending = this.pending.get(response.data.id);
    if (!pending) return;
    this.pending.delete(response.data.id);
    clearTimeout(pending.timer);
    pending.cleanup();
    if (!response.data.ok) {
      const code = response.data.error?.code ?? "IPC_ERROR";
      pending.reject(new OpenUseError(isKnownErrorCode(code) ? code : "IPC_ERROR", response.data.error?.message ?? "The native action failed."));
      return;
    }
    pending.resolve(response.data.result);
  }

  private failPending(error: OpenUseError): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.cleanup();
      request.reject(error);
      this.pending.delete(id);
    }
  }

  private handleProtocolFailure(error: OpenUseError): void {
    this.failPending(error);
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.lines?.close();
    this.lines = undefined;
    this.processState = "offline";
    if (!child.killed) child.kill();
  }

  private handleProcessExit(exitedChild: ChildProcessWithoutNullStreams, cause?: unknown): void {
    if (this.child !== exitedChild) return;
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.lines?.close();
    this.lines = undefined;
    this.failPending(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar stopped unexpectedly.", cause));
    this.processState = "offline";
  }

  private sendCancel(child: ChildProcessWithoutNullStreams | undefined, requestId: string): void {
    if (!child || child.killed || !child.stdin.writable) return;
    const id = `native-cancel-${++this.sequence}`;
    const payload = `${JSON.stringify({ id, method: "cancel", params: { requestId } })}\n`;
    try {
      child.stdin.write(payload, "utf8", (error) => {
        if (!error || this.child !== child) return;
        this.handleProtocolFailure(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar could not receive cancellation."));
      });
    } catch {
      if (this.child === child) this.handleProtocolFailure(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar could not receive cancellation."));
    }
  }

  private resolveEnginePath(): string | undefined {
    const configured = process.env.OPENUSE_NATIVE_ENGINE_PATH;
    if (configured) return configured;
    if (!this.options.isPackaged) return join(this.options.appPath, "..", "..", "native", "windows", "publish", "OpenUse.WindowsController.exe");
    return join(this.options.resourcesPath, "native", "windows", "OpenUse.WindowsController.exe");
  }
}

function isKnownErrorCode(value: string): value is OpenUseError["code"] {
  return [
    "WINDOW_NOT_FOUND", "ELEMENT_NOT_FOUND", "APP_NOT_ALLOWED", "USER_DENIED", "ACTION_TIMEOUT",
    "MODEL_UNSUPPORTED", "MODEL_FAILED", "NATIVE_ENGINE_OFFLINE", "STALE_UI_STATE", "TASK_CANCELLED",
    "MAX_ACTIONS_REACHED", "INVALID_TOOL_INPUT", "CREDENTIAL_INTERACTION_DISABLED", "UNSUPPORTED_ACTION", "IPC_ERROR",
  ].includes(value);
}
