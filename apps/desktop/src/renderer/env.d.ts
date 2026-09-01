import type { AppSnapshot, PermissionDecision, PermissionLevel, RuntimeEvent } from "@openuse/shared";

declare global {
  interface Window {
    openuse: {
      getSnapshot(): Promise<AppSnapshot>;
      setModel(modelId: string): Promise<void>;
      saveGatewayApiKey(apiKey: string): Promise<void>;
      startTask(command: string): Promise<void>;
      stopTask(): Promise<void>;
      decidePermission(id: string, decision: PermissionDecision): Promise<void>;
      setAppPermission(appName: string, level: PermissionLevel): Promise<void>;
      onEvent(listener: (event: RuntimeEvent) => void): () => void;
    };
  }
}

export {};
