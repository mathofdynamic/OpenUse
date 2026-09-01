import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nativeResponseSchema, type NativeMethod, type NativeMethodParams, type NativeMethodResult } from "@openuse/protocol";
import { OpenUseError, type EngineStatus } from "@openuse/shared";
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
  private processState: EngineStatus["state"];

  constructor(private readonly options: NativeProcessOptions) {
    this.processState = options.platform === "win32" ? "offline" : "unsupported";
  }

  get status(): EngineStatus {
    if (this.options.platform !== "win32") {
      return { platform: this.options.platform, state: "unsupported", detail: "OpenUse controls Windows only." };
    }
    if (this.child && !this.child.killed) {
      return {
        platform: this.options.platform,
        state: this.processState === "starting" ? "starting" : "ready",
        detail: this.processState === "starting" ? "Starting the Windows sidecar." : "Windows sidecar connected.",
      };
    }
    const enginePath = this.resolveEnginePath();
    const available = Boolean(enginePath && existsSync(enginePath));
    return {
      platform: this.options.platform,
      state: available ? "ready" : this.processState === "stopped" ? "stopped" : "offline",
      detail: available
        ? "Windows sidecar is ready to start."
        : "Publish the Windows sidecar with pnpm native:build.",
    };
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
    await this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar is offline.");
    const id = `native-${++this.sequence}`;
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
        pending.cleanup();
        reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
      };
      signal?.addEventListener("abort", abort, { once: true });
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
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.cleanup();
      request.reject(new OpenUseError("TASK_CANCELLED", "The task was stopped."));
      this.pending.delete(id);
    }
    this.lines?.close();
    this.lines = undefined;
    const child = this.child;
    this.child = undefined;
    this.processState = "offline";
    if (child && !child.killed) child.kill();
  }

  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    const enginePath = this.resolveEnginePath();
    if (!enginePath || !existsSync(enginePath)) {
      throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar executable is not available.");
    }
    this.processState = "starting";
    const child = spawn(enginePath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", () => undefined);
    child.once("error", (error) => this.handleProcessExit(error));
    child.once("exit", () => this.handleProcessExit());
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    if (!this.child) throw new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar stopped while starting.");
    this.processState = "ready";
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const response = nativeResponseSchema.safeParse(parsed);
    if (!response.success) return;
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

  private handleProcessExit(cause?: unknown): void {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.lines?.close();
    this.lines = undefined;
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.cleanup();
      request.reject(new OpenUseError("NATIVE_ENGINE_OFFLINE", "The Windows sidecar stopped unexpectedly.", cause));
      this.pending.delete(id);
    }
    this.processState = "offline";
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
