import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface SecretFile {
  version: 1;
  gatewayApiKey: string;
}

export class GatewaySecretStore {
  constructor(
    private readonly filePath: string,
    private readonly storage: SafeStorageAdapter,
  ) {}

  async read(): Promise<string | undefined> {
    let parsed: SecretFile;
    try {
      parsed = JSON.parse(await readFile(this.filePath, "utf8")) as SecretFile;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
    if (parsed.version !== 1 || !parsed.gatewayApiKey) return undefined;
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("Electron safe storage is unavailable on this device.");
    }
    return this.storage.decryptString(Buffer.from(parsed.gatewayApiKey, "base64"));
  }

  async isConfigured(): Promise<boolean> {
    return (await this.read()) !== undefined;
  }

  async write(value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) throw new Error("The Gateway API key cannot be empty.");
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error("Electron safe storage is unavailable on this device.");
    }
    const encrypted = this.storage.encryptString(normalized).toString("base64");
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const data: SecretFile = { version: 1, gatewayApiKey: encrypted };
    await writeFile(temporaryPath, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
