import { contextBridge, ipcRenderer } from "electron";
import type { GatewayConnectionResult } from "@openuse/ai";
import type { AppSnapshot, PermissionDecision, PermissionLevel, RuntimeEvent, ProviderId, ReasoningEffort } from "@openuse/shared";

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:get-snapshot"),
  setModel: (modelId: string): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:set-model", { modelId }),
  setProvider: (provider: ProviderId): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:set-provider", { provider }),
  setLocale: (locale: "en" | "fa"): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:set-locale", { locale }),
  setReasoningEffort: (reasoningEffort: ReasoningEffort): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:set-reasoning", { reasoningEffort }),
  setAppearance: (settings: { primaryColor?: string; backgroundBlur?: number; backgroundOpacity?: number; showAgentCursor?: boolean }): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:set-appearance", settings),
  setCustomProvider: (settings: { baseUrl?: string; modelId?: string; capabilities?: { toolCalling: boolean; vision: boolean; reasoning: boolean } }): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:set-custom-provider", settings),
  saveGatewayApiKey: (apiKey: string): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:save-gateway-key", { apiKey }),
  saveCustomApiKey: (apiKey: string): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:save-custom-key", { apiKey }),
  testGatewayConnection: (modelId: string): Promise<GatewayConnectionResult> => ipcRenderer.invoke("openuse:test-gateway", { modelId }),
  runSelfTest: (): Promise<void> => ipcRenderer.invoke("openuse:self-test"),
  openMacPrivacy: (area: "accessibility" | "screen-recording"): Promise<void> => ipcRenderer.invoke("openuse:open-mac-privacy", { area }),
  relaunch: (): Promise<void> => ipcRenderer.invoke("openuse:relaunch"),
  startTask: (command: string): Promise<void> => ipcRenderer.invoke("openuse:start-task", { command }),
  stopTask: (): Promise<void> => ipcRenderer.invoke("openuse:stop-task"),
  refreshModelCatalog: (): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:refresh-model-catalog"),
  resetUsage: (): Promise<AppSnapshot> => ipcRenderer.invoke("openuse:reset-usage"),
  decidePermission: (id: string, decision: PermissionDecision): Promise<void> =>
    ipcRenderer.invoke("openuse:permission-decision", { id, decision }),
  setAppPermission: (appName: string, level: PermissionLevel, appIdentity?: string): Promise<void> =>
    ipcRenderer.invoke("openuse:set-app-permission", { appName, level, appIdentity }),
  onEvent: (listener: (event: RuntimeEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: RuntimeEvent) => listener(payload);
    ipcRenderer.on("openuse:event", handler);
    return () => ipcRenderer.removeListener("openuse:event", handler);
  },
  onSnapshot: (listener: (snapshot: AppSnapshot) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppSnapshot) => listener(payload);
    ipcRenderer.on("openuse:snapshot", handler);
    return () => ipcRenderer.removeListener("openuse:snapshot", handler);
  },
};

contextBridge.exposeInMainWorld("openuse", api);
