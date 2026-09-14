import { contextBridge, ipcRenderer } from "electron";
import type { CursorInteraction } from "@openuse/shared";

interface OverlayState {
  visible: boolean;
  color: string;
  interaction: CursorInteraction;
  x?: number;
  y?: number;
  sequence: number;
}

contextBridge.exposeInMainWorld("openuseOverlay", {
  onState: (listener: (state: OverlayState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OverlayState) => listener(state);
    ipcRenderer.on("openuse:overlay-state", handler);
    return () => ipcRenderer.removeListener("openuse:overlay-state", handler);
  },
});
