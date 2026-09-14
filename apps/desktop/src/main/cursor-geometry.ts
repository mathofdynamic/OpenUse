import type { CursorTarget, QualificationBounds } from "@openuse/shared";

export interface OverlayDisplay {
  index: number;
  bounds: QualificationBounds;
  scaleFactor: number;
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function virtualDisplayBounds(displays: readonly OverlayDisplay[]): QualificationBounds {
  if (displays.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const left = Math.min(...displays.map((display) => display.bounds.x));
  const top = Math.min(...displays.map((display) => display.bounds.y));
  const right = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
  const bottom = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/**
 * Maps native target coordinates into the Electron overlay's DIP coordinate
 * space. Windows reports physical virtual-screen pixels; macOS reports global
 * screen points. The mapping is deliberately pure so DPI and monitor-offset
 * behavior can be qualified without a running BrowserWindow.
 */
export function mapCursorTarget(target: CursorTarget, displays: readonly OverlayDisplay[], overlayBounds: QualificationBounds): { x: number; y: number } | undefined {
  if (!Number.isFinite(target.point.x) || !Number.isFinite(target.point.y)) return undefined;
  if (target.coordinateSystem !== "virtual-screen-physical-pixels") {
    return { x: target.point.x - overlayBounds.x, y: target.point.y - overlayBounds.y };
  }

  const source = target.display;
  if (!source || displays.length === 0) {
    return { x: target.point.x - overlayBounds.x, y: target.point.y - overlayBounds.y };
  }
  const candidate = displays
    .map((display, index) => ({ display, score: displayScore(source.bounds, source.scaleFactor, display, source.index === index) }))
    .sort((left, right) => left.score - right.score)[0]?.display;
  if (!candidate) return undefined;

  const widthRatio = source.bounds.width > 0 ? candidate.bounds.width / source.bounds.width : 1 / finitePositive(source.scaleFactor, 1);
  const heightRatio = source.bounds.height > 0 ? candidate.bounds.height / source.bounds.height : 1 / finitePositive(source.scaleFactor, 1);
  return {
    x: candidate.bounds.x + (target.point.x - source.bounds.x) * widthRatio - overlayBounds.x,
    y: candidate.bounds.y + (target.point.y - source.bounds.y) * heightRatio - overlayBounds.y,
  };
}

function displayScore(source: QualificationBounds, sourceScaleFactor: number | undefined, candidate: OverlayDisplay, indexHint: boolean): number {
  const scale = finitePositive(sourceScaleFactor, 1);
  const physicalWidth = candidate.bounds.width * candidate.scaleFactor;
  const physicalHeight = candidate.bounds.height * candidate.scaleFactor;
  const sourceWidth = source.width * scale;
  const sourceHeight = source.height * scale;
  const widthError = Math.abs(physicalWidth - sourceWidth) / Math.max(1, sourceWidth);
  const heightError = Math.abs(physicalHeight - sourceHeight) / Math.max(1, sourceHeight);
  return widthError + heightError + (indexHint ? 0 : 0.0001);
}
