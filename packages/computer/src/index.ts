import type {
  AppInfo,
  NativeMethod,
  NativeMethodParams,
  NativeMethodResult,
  WindowInspection,
  WindowInfo,
  Screenshot,
  OperationResult,
} from "@openuse/protocol";
import { OpenUseError } from "@openuse/shared";

export interface ComputerController {
  listApps(signal?: AbortSignal): Promise<{ apps: AppInfo[] }>;
  listWindows(signal?: AbortSignal): Promise<{ windows: WindowInfo[] }>;
  inspectWindow(windowId: string, signal?: AbortSignal): Promise<WindowInspection>;
  captureScreen(windowId?: string, signal?: AbortSignal): Promise<Screenshot>;
  launchApp(app: string, args?: string[], signal?: AbortSignal): Promise<OperationResult>;
  focusWindow(windowId: string, signal?: AbortSignal): Promise<OperationResult>;
  click(input: NativeMethodParams["click"], signal?: AbortSignal): Promise<OperationResult>;
  clickElement(
    input: NativeMethodParams["clickElement"],
    signal?: AbortSignal,
  ): Promise<OperationResult>;
  doubleClick(
    input: NativeMethodParams["doubleClick"],
    signal?: AbortSignal,
  ): Promise<OperationResult>;
  typeText(
    input: NativeMethodParams["typeText"],
    signal?: AbortSignal,
  ): Promise<OperationResult>;
  pressKey(input: NativeMethodParams["pressKey"], signal?: AbortSignal): Promise<OperationResult>;
  scroll(input: NativeMethodParams["scroll"], signal?: AbortSignal): Promise<OperationResult>;
  wait(milliseconds: number, signal?: AbortSignal): Promise<{ ok: true; waitedMs: number }>;
  stop?(): Promise<void> | void;
}

export interface ComputerRpc {
  request<M extends NativeMethod>(
    method: M,
    params: NativeMethodParams[M],
    signal?: AbortSignal,
  ): Promise<NativeMethodResult[M]>;
}

export class NativeComputerController implements ComputerController {
  constructor(private readonly rpc: ComputerRpc) {}

  listApps(signal?: AbortSignal) {
    return this.rpc.request("listApps", {}, signal);
  }

  listWindows(signal?: AbortSignal) {
    return this.rpc.request("listWindows", {}, signal);
  }

  inspectWindow(windowId: string, signal?: AbortSignal) {
    return this.rpc.request("inspectWindow", { windowId }, signal);
  }

  captureScreen(windowId?: string, signal?: AbortSignal) {
    return this.rpc.request("captureScreen", windowId ? { windowId } : {}, signal);
  }

  launchApp(app: string, args?: string[], signal?: AbortSignal) {
    return this.rpc.request("launchApp", args ? { app, arguments: args } : { app }, signal);
  }

  focusWindow(windowId: string, signal?: AbortSignal) {
    return this.rpc.request("focusWindow", { windowId }, signal);
  }

  click(input: NativeMethodParams["click"], signal?: AbortSignal) {
    return this.rpc.request("click", input, signal);
  }

  clickElement(input: NativeMethodParams["clickElement"], signal?: AbortSignal) {
    return this.rpc.request("clickElement", input, signal);
  }

  doubleClick(input: NativeMethodParams["doubleClick"], signal?: AbortSignal) {
    return this.rpc.request("doubleClick", input, signal);
  }

  typeText(input: NativeMethodParams["typeText"], signal?: AbortSignal) {
    return this.rpc.request("typeText", input, signal);
  }

  pressKey(input: NativeMethodParams["pressKey"], signal?: AbortSignal) {
    return this.rpc.request("pressKey", input, signal);
  }

  scroll(input: NativeMethodParams["scroll"], signal?: AbortSignal) {
    return this.rpc.request("scroll", input, signal);
  }

  wait(milliseconds: number, signal?: AbortSignal) {
    return this.rpc.request("wait", { milliseconds }, signal);
  }
}

export interface MockComputerState {
  windows: WindowInfo[];
  inspections: Record<string, WindowInspection>;
  actions: Array<{ method: NativeMethod; params: unknown }>;
  typedText: string[];
}

export class MockComputerController implements ComputerController {
  readonly state: MockComputerState;

  constructor(state?: Partial<MockComputerState>) {
    const window: WindowInfo = {
      id: "mock-notepad-window",
      title: "Untitled - Notepad",
      app: "Notepad",
      appIdentity: "notepad",
      processName: "notepad",
      processId: 1001,
      className: "Notepad",
      bounds: { x: 80, y: 80, width: 920, height: 680 },
      focused: true,
    };
    const inspection: WindowInspection = {
      window,
      truncated: false,
      elements: [
        {
          id: "el_1",
          parentId: undefined,
          role: "Edit",
          name: "Text editor",
          automationId: "TextEditor",
          className: "RichEditD2DPT",
          bounds: { x: 120, y: 150, width: 820, height: 560 },
          enabled: true,
          offscreen: false,
          supportedPatterns: ["Value", "Text"],
        },
      ],
    };
    this.state = {
      windows: state?.windows ?? [],
      inspections: state?.inspections ?? {},
      actions: state?.actions ?? [],
      typedText: state?.typedText ?? [],
    };
    if (this.state.windows.length === 0) this.state.windows.push(window);
    if (Object.keys(this.state.inspections).length === 0) {
      this.state.inspections[window.id] = inspection;
    }
  }

  private record<M extends NativeMethod>(method: M, params: NativeMethodParams[M]) {
    this.state.actions.push({ method, params });
  }

  private check(signal?: AbortSignal) {
    if (signal?.aborted) throw new OpenUseError("TASK_CANCELLED", "The task was stopped.");
  }

  async listApps(signal?: AbortSignal) {
    this.check(signal);
    this.record("listApps", {});
    return { apps: [{ id: "mock-notepad", name: "Notepad", processName: "notepad", processId: 1001, appIdentity: "notepad" }] };
  }

  async listWindows(signal?: AbortSignal) {
    this.check(signal);
    this.record("listWindows", {});
    return { windows: this.state.windows };
  }

  async inspectWindow(windowId: string, signal?: AbortSignal) {
    this.check(signal);
    this.record("inspectWindow", { windowId });
    const inspection = this.state.inspections[windowId];
    if (!inspection) throw new OpenUseError("WINDOW_NOT_FOUND", "Mock window not found.");
    return inspection;
  }

  async captureScreen(windowId?: string, signal?: AbortSignal) {
    this.check(signal);
    this.record("captureScreen", { windowId });
    return {
      data: "",
      mimeType: "image/png" as const,
      width: 1,
      height: 1,
      source: "screen" as const,
      coordinateSystem: "virtual-screen-physical-pixels" as const,
      dpi: 96,
      captureBounds: { x: 0, y: 0, width: 1, height: 1 },
    };
  }

  async launchApp(app: string, args?: string[], signal?: AbortSignal) {
    this.check(signal);
    this.record("launchApp", { app, arguments: args });
    return { ok: true as const, changed: true, detail: `${app} launched` };
  }

  async focusWindow(windowId: string, signal?: AbortSignal) {
    this.check(signal);
    this.record("focusWindow", { windowId });
    return { ok: true as const, changed: true, window: this.state.windows.find((item) => item.id === windowId) };
  }

  async click(input: NativeMethodParams["click"], signal?: AbortSignal) {
    this.check(signal);
    this.record("click", input);
    return { ok: true as const, changed: true, interactionMethod: "coordinate-input" as const };
  }

  async clickElement(input: NativeMethodParams["clickElement"], signal?: AbortSignal) {
    this.check(signal);
    this.record("clickElement", input);
    return { ok: true as const, changed: true, interactionMethod: "uia-native" as const, targetElementId: input.elementId };
  }

  async doubleClick(input: NativeMethodParams["doubleClick"], signal?: AbortSignal) {
    this.check(signal);
    this.record("doubleClick", input);
    return { ok: true as const, changed: true, interactionMethod: "coordinate-input" as const };
  }

  async typeText(input: NativeMethodParams["typeText"], signal?: AbortSignal) {
    this.check(signal);
    this.record("typeText", input);
    this.state.typedText.push(input.text);
    return { ok: true as const, changed: true, interactionMethod: "uia-native" as const, targetElementId: input.elementId };
  }

  async pressKey(input: NativeMethodParams["pressKey"], signal?: AbortSignal) {
    this.check(signal);
    this.record("pressKey", input);
    return { ok: true as const, changed: true, interactionMethod: "keyboard-input" as const };
  }

  async scroll(input: NativeMethodParams["scroll"], signal?: AbortSignal) {
    this.check(signal);
    this.record("scroll", input);
    return { ok: true as const, changed: true, interactionMethod: "coordinate-input" as const };
  }

  async wait(milliseconds: number, signal?: AbortSignal) {
    this.check(signal);
    this.record("wait", { milliseconds });
    return { ok: true as const, waitedMs: milliseconds };
  }
}

export class UnavailableComputerController implements ComputerController {
  private fail(): never {
    throw new OpenUseError(
      "NATIVE_ENGINE_OFFLINE",
      "The Windows computer engine is unavailable on this host.",
    );
  }

  listApps() { return Promise.reject(this.fail()); }
  listWindows() { return Promise.reject(this.fail()); }
  inspectWindow(_windowId: string) { return Promise.reject(this.fail()); }
  captureScreen(_windowId?: string) { return Promise.reject(this.fail()); }
  launchApp(_app: string) { return Promise.reject(this.fail()); }
  focusWindow(_windowId: string) { return Promise.reject(this.fail()); }
  click(_input: NativeMethodParams["click"]) { return Promise.reject(this.fail()); }
  clickElement(_input: NativeMethodParams["clickElement"]) { return Promise.reject(this.fail()); }
  doubleClick(_input: NativeMethodParams["doubleClick"]) { return Promise.reject(this.fail()); }
  typeText(_input: NativeMethodParams["typeText"]) { return Promise.reject(this.fail()); }
  pressKey(_input: NativeMethodParams["pressKey"]) { return Promise.reject(this.fail()); }
  scroll(_input: NativeMethodParams["scroll"]) { return Promise.reject(this.fail()); }
  wait(_milliseconds: number) { return Promise.reject(this.fail()); }
}

export type { AppInfo, WindowInfo, WindowInspection, Screenshot, OperationResult } from "@openuse/protocol";
