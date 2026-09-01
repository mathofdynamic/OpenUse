import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultPermissionRecords } from "@openuse/permissions";
import type { SafeStorageAdapter } from "./secure-store";
import { GatewaySecretStore } from "./secure-store";
import { SettingsStore } from "./settings-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openuse-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

class FakeSafeStorage implements SafeStorageAdapter {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from(`cipher:${value}`, "utf8"); }
  decryptString(value: Buffer): string { return value.toString("utf8").replace(/^cipher:/, ""); }
}

describe("desktop local stores", () => {
  it("stores only encrypted Gateway key material on disk", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "secrets.json");
    const store = new GatewaySecretStore(path, new FakeSafeStorage());

    await store.write("vca_private_test_key");

    expect(await store.read()).toBe("vca_private_test_key");
    expect(await store.isConfigured()).toBe(true);
    expect(await readFile(path, "utf8")).not.toContain("vca_private_test_key");
  });

  it("initializes and persists model and application permissions", async () => {
    const directory = await temporaryDirectory();
    const store = new SettingsStore(join(directory, "settings.json"));

    await store.initialize();
    expect(store.persisted.permissions.map(({ appName, level }) => ({ appName, level }))).toEqual(
      defaultPermissionRecords().map(({ appName, level }) => ({ appName, level })),
    );
    await store.setModel("google/gemini-3-flash");
    await store.setPermission("Paint", "ASK");

    const persisted = new SettingsStore(join(directory, "settings.json"));
    await persisted.initialize();
    expect(persisted.persisted.modelId).toBe("google/gemini-3-flash");
    expect(persisted.persisted.permissions.find((record) => record.appName === "Paint")?.level).toBe("ASK");
  });
});
