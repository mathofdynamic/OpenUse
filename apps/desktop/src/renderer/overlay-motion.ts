export interface CursorPoint {
  x: number;
  y: number;
}

export interface CursorMotionState {
  position: CursorPoint;
  velocity: CursorPoint;
}

export interface CursorMotionStep extends CursorMotionState {
  settled: boolean;
}

/** A small critically-damped spring for an interruptible, compositor-friendly cursor path. */
export function advanceCursorSpring(state: CursorMotionState, target: CursorPoint, deltaMs: number): CursorMotionStep {
  const dt = Math.min(34, Math.max(1, Number.isFinite(deltaMs) ? deltaMs : 16.67)) / 1000;
  const angularFrequency = 12;
  const damping = angularFrequency * 2;
  const acceleration = {
    x: (target.x - state.position.x) * angularFrequency * angularFrequency - state.velocity.x * damping,
    y: (target.y - state.position.y) * angularFrequency * angularFrequency - state.velocity.y * damping,
  };
  const velocity = {
    x: state.velocity.x + acceleration.x * dt,
    y: state.velocity.y + acceleration.y * dt,
  };
  const position = {
    x: state.position.x + velocity.x * dt,
    y: state.position.y + velocity.y * dt,
  };
  const distance = Math.hypot(target.x - position.x, target.y - position.y);
  const speed = Math.hypot(velocity.x, velocity.y);
  if (distance < 0.35 && speed < 3) return { position: target, velocity: { x: 0, y: 0 }, settled: true };
  return { position, velocity, settled: false };
}
