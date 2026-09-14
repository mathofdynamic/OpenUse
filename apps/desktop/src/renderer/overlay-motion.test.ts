import { describe, expect, it } from "vitest";
import { advanceCursorSpring } from "./overlay-motion";

describe("agent cursor motion", () => {
  it("travels toward a new target over multiple frames", () => {
    let state = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
    const first = advanceCursorSpring(state, { x: 400, y: 200 }, 16.67);
    expect(first.position.x).toBeGreaterThan(0);
    expect(first.position.x).toBeLessThan(400);
    state = first;
    const second = advanceCursorSpring(state, { x: 400, y: 200 }, 16.67);
    expect(second.position.x).toBeGreaterThan(first.position.x);
  });

  it("settles exactly at the target", () => {
    let state = { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
    for (let index = 0; index < 180; index += 1) {
      const step = advanceCursorSpring(state, { x: 120, y: 80 }, 16.67);
      state = step;
      if (step.settled) break;
    }
    expect(state.position).toEqual({ x: 120, y: 80 });
    expect(state.velocity).toEqual({ x: 0, y: 0 });
  });
});
