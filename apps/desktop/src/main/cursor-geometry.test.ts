import { describe, expect, it } from "vitest";
import type { CursorTarget } from "@openuse/shared";
import { mapCursorTarget, virtualDisplayBounds, type OverlayDisplay } from "./cursor-geometry";

const oneHundredTwentyFivePercent: OverlayDisplay[] = [{
  index: 0,
  bounds: { x: 0, y: 0, width: 1536, height: 864 },
  scaleFactor: 1.25,
}];

describe("agent cursor geometry", () => {
  it("maps physical Windows coordinates to DIP at 125 percent scaling", () => {
    const target: CursorTarget = {
      point: { x: 960, y: 540 },
      display: { index: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, dpi: 120, scaleFactor: 1.25, primary: true },
      coordinateSystem: "virtual-screen-physical-pixels",
    };
    expect(mapCursorTarget(target, oneHundredTwentyFivePercent, virtualDisplayBounds(oneHundredTwentyFivePercent))).toEqual({ x: 768, y: 432 });
  });

  it("preserves a negative secondary-display offset", () => {
    const displays: OverlayDisplay[] = [
      { index: 0, bounds: { x: 0, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 },
      { index: 1, bounds: { x: -1536, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 },
    ];
    const target: CursorTarget = {
      point: { x: -960, y: 540 },
      display: { index: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, workArea: { x: -1920, y: 0, width: 1920, height: 1040 }, dpi: 120, scaleFactor: 1.25, primary: false },
      coordinateSystem: "virtual-screen-physical-pixels",
    };
    expect(virtualDisplayBounds(displays)).toEqual({ x: -1536, y: 0, width: 3072, height: 864 });
    expect(mapCursorTarget(target, displays, virtualDisplayBounds(displays))).toEqual({ x: 768, y: 432 });
  });

  it("uses global screen points directly for macOS", () => {
    const target: CursorTarget = { point: { x: -120, y: 80 }, coordinateSystem: "global-screen-points" };
    expect(mapCursorTarget(target, [{ index: 0, bounds: { x: -320, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }], { x: -320, y: 0, width: 2560, height: 1440 })).toEqual({ x: 200, y: 80 });
  });
});
