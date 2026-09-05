import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { CursorInteraction } from "@openuse/shared";
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
  const overlayWindow = window as OverlayWindow;
  useEffect(() => overlayWindow.openuseOverlay?.onState(setState), []);
  if (!state.visible || state.x === undefined || state.y === undefined) return null;
  return <div className="agent-cursor-layer" style={{ "--cursor-color": state.color } as CSSProperties} aria-hidden="true"><div className="agent-cursor" data-interaction={state.interaction} style={{ transform: `translate3d(${state.x}px, ${state.y}px, 0)` }}><span className="agent-cursor-pointer" /><span className="agent-cursor-pulse agent-cursor-pulse-one" key={`${state.sequence}-one`} /><span className="agent-cursor-pulse agent-cursor-pulse-two" key={`${state.sequence}-two`} /><span className="agent-cursor-label">OpenUse</span></div></div>;
}
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(<AgentCursorOverlay />);
