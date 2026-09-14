import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface SecretFile {
  version: 1 | 2;
  gatewayApiKey?: string;
  customApiKey?: string;
}

type SecretSlot = "gatewayApiKey" | "customApiKey";

export class GatewaySecretStore {
  constructor(private readonly filePath: string, private readonly storage: SafeStorageAdapter) {}

  read(): Promise<string | undefined> { return this.readSlot("gatewayApiKey"); }
  readCustom(): Promise<string | undefined> { return this.readSlot("customApiKey"); }

  async isConfigured(): Promise<boolean> { return (await this.read()) !== undefined; }
  async isCustomConfigured(): Promise<boolean> { return (await this.readCustom()) !== undefined; }

  write(value: string): Promise<void> { return this.writeSlot("gatewayApiKey", value, "The Gateway API key cannot be empty."); }
  writeCustom(value: string): Promise<void> {
    return this.writeSlot("customApiKey", value, "The custom API key cannot be empty.");
  }

  private async readSlot(slot: SecretSlot): Promise<string | undefined> {
    let parsed: SecretFile;
    try {
      parsed = JSON.parse(await readFile(this.filePath, "utf8")) as SecretFile;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    const encrypted = parsed.version === 1 || parsed.version === 2 ? parsed[slot] : undefined;
    if (!encrypted) return undefined;
    if (!this.storage.isEncryptionAvailable()) throw new Error("Electron safe storage is unavailable on this device.");
    return this.storage.decryptString(Buffer.from(encrypted, "base64"));
  }

  private async writeSlot(slot: SecretSlot, value: string, emptyMessage: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) throw new Error(emptyMessage);
    if (!this.storage.isEncryptionAvailable()) throw new Error("Electron safe storage is unavailable on this device.");
    const existing = await this.readFileSafe();
    const encrypted = this.storage.encryptString(normalized).toString("base64");
    const data: SecretFile = {
      version: 2,
      ...(existing?.gatewayApiKey ? { gatewayApiKey: existing.gatewayApiKey } : {}),
      ...(existing?.customApiKey ? { customApiKey: existing.customApiKey } : {}),
      [slot]: encrypted,
    };
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }

  private async readFileSafe(): Promise<SecretFile | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as SecretFile;
      return parsed.version === 1 || parsed.version === 2 ? parsed : undefined;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
}
