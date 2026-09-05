import type { GatewayConnectionResult } from "@openuse/ai";
import type { AppSnapshot, PermissionDecision, PermissionLevel, ProviderId, ReasoningEffort, RuntimeEvent } from "@openuse/shared";

declare global {
  interface Window {
    openuse: {
      getSnapshot(): Promise<AppSnapshot>;
      setModel(modelId: string): Promise<AppSnapshot>;
      setProvider(provider: ProviderId): Promise<AppSnapshot>;
      setLocale(locale: "en" | "fa"): Promise<AppSnapshot>;
      setReasoningEffort(reasoningEffort: ReasoningEffort): Promise<AppSnapshot>;
      setAppearance(settings: { primaryColor?: string; backgroundBlur?: number; backgroundOpacity?: number; showAgentCursor?: boolean }): Promise<AppSnapshot>;
      setCustomProvider(settings: { baseUrl?: string; modelId?: string; capabilities?: { toolCalling: boolean; vision: boolean; reasoning: boolean } }): Promise<AppSnapshot>;
      saveGatewayApiKey(apiKey: string): Promise<AppSnapshot>;
      saveCustomApiKey(apiKey: string): Promise<AppSnapshot>;
      testGatewayConnection(modelId: string): Promise<GatewayConnectionResult>;
      runSelfTest(): Promise<void>;
      openMacPrivacy(area: "accessibility" | "screen-recording"): Promise<void>;
      relaunch(): Promise<void>;
      startTask(command: string): Promise<void>;
      stopTask(): Promise<void>;
      refreshModelCatalog(): Promise<AppSnapshot>;
      resetUsage(): Promise<AppSnapshot>;
      decidePermission(id: string, decision: PermissionDecision): Promise<void>;
      setAppPermission(appName: string, level: PermissionLevel, appIdentity?: string): Promise<void>;
      onEvent(listener: (event: RuntimeEvent) => void): () => void;
      onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
    };
  }
}

export {};
