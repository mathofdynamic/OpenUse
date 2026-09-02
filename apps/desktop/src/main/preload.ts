import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, PermissionDecision, PermissionLevel, RuntimeEvent } from "@openuse/shared";

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:get-snapshot"),
  setModel: (modelId: string): Promise<void> => ipcRenderer.invoke("openuse:set-model", { modelId }),
  saveGatewayApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke("openuse:save-gateway-key", { apiKey }),
  startTask: (command: string): Promise<void> => ipcRenderer.invoke("openuse:start-task", { command }),
  stopTask: (): Promise<void> => ipcRenderer.invoke("openuse:stop-task"),
  decidePermission: (id: string, decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke("openuse:permission-decision", { id, decision }),
  setAppPermission: (appName: string, level: PermissionLevel, appIdentity?: string): Promise<void> =>
    ipcRenderer.invoke("openuse:set-app-permission", { appName, level, appIdentity }),
  onEvent: (listener: (event: RuntimeEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: RuntimeEvent) => listener(payload);
    ipcRenderer.on("openuse:event", handler);
    return () => ipcRenderer.removeListener("openuse:event", handler);
  },
};

contextBridge.exposeInMainWorld("openuse", api);
