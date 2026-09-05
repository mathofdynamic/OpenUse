import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ID } from "@openuse/ai";
import { defaultPermissionRecords } from "@openuse/permissions";
import { clampBlur, clampOpacity, normalizeHexColor, SettingsStore } from "./settings-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporarySettingsFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openuse-settings-"));
  temporaryDirectories.push(directory);
  return join(directory, "settings.json");
}

describe("settings schema v4", () => {
  it("migrates v2 without resetting the model or permissions", async () => {
    const path = await temporarySettingsFile();
    await writeFile(path, JSON.stringify({ version: 2, provider: "vercel-gateway", modelId: "google/gemini-3-flash", permissions: defaultPermissionRecords() }));

    const store = new SettingsStore(path);
    await store.initialize();

    expect(store.persisted.version).toBe(4);
    expect(store.persisted.locale).toBe("en");
    expect(store.persisted.modelId).toBe("google/gemini-3-flash");
    expect(store.persisted.permissions).toHaveLength(defaultPermissionRecords().length);
    expect(store.persisted.primaryColor).toBe("#c8f36a");
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 4, locale: "en", modelId: "google/gemini-3-flash" });
  });

  it("preserves a valid Persian locale while migrating v3", async () => {
    const path = await temporarySettingsFile();
    await writeFile(path, JSON.stringify({ version: 3, locale: "fa", modelId: DEFAULT_MODEL_ID, permissions: defaultPermissionRecords() }));

    const store = new SettingsStore(path);
    await store.initialize();

    expect(store.persisted.version).toBe(4);
    expect(store.persisted.locale).toBe("fa");
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 4, locale: "fa" });
  });

  it("sanitizes malformed v3 appearance and custom-provider values", async () => {
    const path = await temporarySettingsFile();
    await writeFile(path, JSON.stringify({
      version: 3,
      locale: "de",
      modelId: DEFAULT_MODEL_ID,
      permissions: defaultPermissionRecords(),
      primaryColor: "not-a-color",
      backgroundBlur: 999,
      backgroundOpacity: 0.01,
      customProvider: { baseUrl: "file:///private", modelId: "", capabilities: { toolCalling: "yes" } },
    }));

    const store = new SettingsStore(path);
    await store.initialize();
    expect(store.persisted.primaryColor).toBe("#c8f36a");
    expect(store.persisted.backgroundBlur).toBe(40);
    expect(store.persisted.backgroundOpacity).toBe(0.45);
    expect(store.persisted.customProvider.baseUrl).toBe("http://localhost:11434/v1");
    expect(store.persisted.customProvider.modelId).toBe("llama3.2-vision");
    expect(store.persisted.customProvider.capabilities).toEqual({ toolCalling: false, vision: false, reasoning: false });
    expect(store.persisted.locale).toBe("en");
  });

  it("clamps public appearance setters and normalizes custom HEX", async () => {
    const path = await temporarySettingsFile();
    const store = new SettingsStore(path);
    await store.initialize();
    await store.setAppearance({ primaryColor: "#ABCDEF", backgroundBlur: -10, backgroundOpacity: 2 });

    expect(store.persisted.primaryColor).toBe("#abcdef");
    expect(store.persisted.backgroundBlur).toBe(0);
    expect(store.persisted.backgroundOpacity).toBe(1);
    expect(clampBlur(Number.NaN)).toBe(18);
    expect(clampOpacity(Number.NaN)).toBe(0.78);
    expect(normalizeHexColor("#123456")).toBe("#123456");
    expect(normalizeHexColor("#12345")).toBe("#c8f36a");
  });

  it("serializes rapid appearance writes and persists locale", async () => {
    const path = await temporarySettingsFile();
    const store = new SettingsStore(path);
    await store.initialize();

    await Promise.all([
      store.setAppearance({ primaryColor: "#123456" }),
      store.setAppearance({ primaryColor: "#8bd5ff" }),
      store.setLocale("fa"),
    ]);

    const reloaded = new SettingsStore(path);
    await reloaded.initialize();
    expect(reloaded.persisted.primaryColor).toBe("#8bd5ff");
    expect(reloaded.persisted.locale).toBe("fa");
  });
});
