import { describe, expect, it } from "vitest";
import { AGENT_CURSOR_WINDOW_POLICY, shouldHideCursorForRuntimeEvent } from "./cursor-overlay-policy";

describe("agent cursor window policy", () => {
  it("keeps the overlay transparent, non-focusable, and click-through", () => {
    expect(AGENT_CURSOR_WINDOW_POLICY).toMatchObject({
      show: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      ignoreMouseEvents: true,
      forwardMouseEvents: true,
    });
  });

  it("hides immediately for Stop and terminal task events", () => {
    expect(shouldHideCursorForRuntimeEvent("stop")).toBe(true);
    expect(shouldHideCursorForRuntimeEvent("task.finished")).toBe(true);
  });
});
