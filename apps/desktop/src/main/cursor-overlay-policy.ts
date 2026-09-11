export const AGENT_CURSOR_WINDOW_POLICY = {
  show: false,
  frame: false,
  transparent: true,
  resizable: false,
  movable: false,
  minimizable: false,
  maximizable: false,
  closable: false,
  skipTaskbar: true,
  focusable: false,
  hasShadow: false,
  alwaysOnTopLevel: "floating",
  ignoreMouseEvents: true,
  forwardMouseEvents: true,
} as const;

export function shouldHideCursorForRuntimeEvent(eventType: "stop" | "task.finished"): boolean {
  return eventType === "stop" || eventType === "task.finished";
}
