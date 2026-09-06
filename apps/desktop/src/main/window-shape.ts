import type { Rectangle } from "electron";

// Match --window-radius. Electron converts these DIP coordinates for the display DPI.
export function roundedWindowShape(width: number, height: number): Rectangle[] {
  const radius = Math.min(14, Math.floor(width / 2), Math.floor(height / 2));
  const rectangles: Rectangle[] = [{ x: 0, y: radius, width, height: height - radius * 2 }];
  for (let y = 0; y < radius; y++) {
    const inset = Math.ceil(radius - Math.sqrt(radius ** 2 - (radius - y - 0.5) ** 2));
    rectangles.push({ x: inset, y, width: width - inset * 2, height: 1 });
    rectangles.push({ x: inset, y: height - y - 1, width: width - inset * 2, height: 1 });
  }
  return rectangles;
}
