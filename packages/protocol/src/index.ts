import { z } from "zod";
import type { EngineSelfTestResult, InteractionMethod } from "@openuse/shared";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppInfo {
  id: string;
  name: string;
  processName: string;
  processId: number;
  appIdentity: string;
}

export interface WindowInfo {
  id: string;
  title: string;
  app: string;
  appIdentity: string;
  processName: string;
  processId: number;
  className: string;
  bounds: Bounds;
  focused: boolean;
}

export interface UiElement {
  id: string;
  parentId?: string;
  role: string;
  name: string;
  automationId?: string;
  className: string;
  bounds: Bounds;
  enabled: boolean;
  offscreen: boolean;
  supportedPatterns: string[];
  value?: string;
}

export interface WindowInspection {
  window: WindowInfo;
  elements: UiElement[];
  truncated: boolean;
}

export interface Screenshot {
  data: string;
  mimeType: "image/png";
  width: number;
  height: number;
  source: "screen" | "window";
  coordinateSystem: "virtual-screen-physical-pixels";
  dpi: number;
  captureBounds: Bounds;
}

export interface OperationResult {
  ok: true;
  changed: boolean;
  window?: WindowInfo;
  inspection?: WindowInspection;
  detail?: string;
  interactionMethod?: InteractionMethod;
  targetElementId?: string;
}

export interface NativeMethodParams {
  listApps: Record<string, never>;
  listWindows: Record<string, never>;
  inspectWindow: { windowId: string };
  captureScreen: { windowId?: string };
  launchApp: { app: string; arguments?: string[] };
  focusWindow: { windowId: string };
  click: { x: number; y: number; button?: "left" | "right" | "middle" };
  clickElement: {
    windowId: string;
    elementId?: string;
    role?: string;
    name?: string;
    automationId?: string;
    className?: string;
  };
  doubleClick: { x: number; y: number };
  typeText: {
    text: string;
    windowId?: string;
    elementId?: string;
    role?: string;
    name?: string;
    automationId?: string;
    className?: string;
  };
  pressKey: { key: string };
  scroll: { amount: number; x?: number; y?: number };
  wait: { milliseconds: number };
  selfTest: Record<string, never>;
}

export interface NativeMethodResult {
  listApps: { apps: AppInfo[] };
  listWindows: { windows: WindowInfo[] };
  inspectWindow: WindowInspection;
  captureScreen: Screenshot;
  launchApp: OperationResult;
  focusWindow: OperationResult;
  click: OperationResult;
  clickElement: OperationResult;
  doubleClick: OperationResult;
  typeText: OperationResult;
  pressKey: OperationResult;
  scroll: OperationResult;
  wait: { ok: true; waitedMs: number };
  selfTest: EngineSelfTestResult;
}

export type NativeMethod = keyof NativeMethodParams;

export interface NativeRequest<M extends NativeMethod = NativeMethod> {
  id: string;
  method: M;
  params: NativeMethodParams[M];
}

export interface NativeError {
  code: string;
  message: string;
}

export type NativeResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: NativeError };

export const nativeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    id: z.string(),
    ok: z.literal(true),
    result: z.unknown().refine((value) => value !== undefined, "A successful response requires a result."),
  }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

export const nativeRequestSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown(),
});

export function isNativeErrorResponse(response: NativeResponse): response is Extract<NativeResponse, { ok: false }> {
  return response.ok === false;
}
