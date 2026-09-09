import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { CursorInteraction } from "@openuse/shared";
import { advanceCursorSpring, type CursorPoint } from "./overlay-motion";
import "./overlay.css";

interface OverlayState {
  visible: boolean;
  color: string;
  interaction: CursorInteraction;
  x?: number;
  y?: number;
  sequence: number;
}

interface OverlayWindow extends Window {
  openuseOverlay?: { onState(listener: (state: OverlayState) => void): () => void };
}

export function AgentCursorOverlay() {
  const [state, setState] = useState<OverlayState>({ visible: false, color: "#c8f36a", interaction: "waiting", sequence: 0 });
  const [position, setPosition] = useState<CursorPoint>({ x: state.x ?? 0, y: state.y ?? 0 });
  const positionRef = useRef<CursorPoint>(position);
  const velocityRef = useRef<CursorPoint>({ x: 0, y: 0 });
  const targetRef = useRef<CursorPoint | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const hasPositionRef = useRef(false);
  const overlayWindow = window as OverlayWindow;
  useEffect(() => overlayWindow.openuseOverlay?.onState(setState), [overlayWindow]);
  useEffect(() => {
    if (!state.visible || state.x === undefined || state.y === undefined) {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      velocityRef.current = { x: 0, y: 0 };
      targetRef.current = undefined;
      return;
    }
    const target = { x: state.x, y: state.y };
    targetRef.current = target;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    if (!hasPositionRef.current || reducedMotion) {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
      positionRef.current = target;
      velocityRef.current = { x: 0, y: 0 };
      hasPositionRef.current = true;
      setPosition(target);
      return;
    }
    if (frameRef.current !== undefined) return;
    let previousTime = performance.now();
    const tick = (time: number) => {
      const currentTarget = targetRef.current;
      if (!currentTarget) {
        frameRef.current = undefined;
        return;
      }
      const next = advanceCursorSpring({ position: positionRef.current, velocity: velocityRef.current }, currentTarget, time - previousTime);
      previousTime = time;
      positionRef.current = next.position;
      velocityRef.current = next.velocity;
      setPosition(next.position);
      if (next.settled) {
        frameRef.current = undefined;
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [state.visible, state.x, state.y]);
  useEffect(() => () => {
    if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
  }, []);
  if (!state.visible || state.x === undefined || state.y === undefined) return null;
  return <div className="agent-cursor-layer" style={{ "--cursor-color": state.color } as CSSProperties} aria-hidden="true"><div className="agent-cursor" data-interaction={state.interaction} style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}><span className="agent-cursor-pointer" /><span className="agent-cursor-pulse agent-cursor-pulse-one" key={`${state.sequence}-one`} /><span className="agent-cursor-pulse agent-cursor-pulse-two" key={`${state.sequence}-two`} /><span className="agent-cursor-label">OpenUse</span></div></div>;
}
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(<AgentCursorOverlay />);
