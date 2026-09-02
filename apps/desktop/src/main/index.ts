import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type { PermissionDecision, PermissionLevel, RuntimeEvent } from "@openuse/shared";
import { OpenUseError, nowIso, type AppSnapshot, type EngineSelfTestResult } from "@openuse/shared";
import { MODEL_CATALOG, testGatewayConnection } from "@openuse/ai";
import { GatewaySecretStore } from "./secure-store";
import { SettingsStore } from "./settings-store";
import { NativeEngineProcess } from "./native-process";
import { TaskRuntime } from "./task-runtime";
import { logRuntimeEvent } from "./runtime-logger";
import { QualificationRecorder } from "./qualification-recorder";

let mainWindow: BrowserWindow | undefined;
let settings: SettingsStore;
let secrets: GatewaySecretStore;
let engine: NativeEngineProcess;
let runtime: TaskRuntime;
let qualification: QualificationRecorder;
let qualificationSelfTest: EngineSelfTestResult | undefined;
let isQuitting = false;

const modelSchema = z.object({ modelId: z.string().min(1).max(160) });
const keySchema = z.object({ apiKey: z.string().trim().min(1).max(500) });
const taskSchema = z.object({ command: z.string().trim().min(1).max(10_000) });
const permissionDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["allow-once", "always-allow", "deny"]),
});
const appPermissionSchema = z.object({
  appName: z.string().trim().min(1).max(160),
  appIdentity: z.string().trim().min(1).max(240).optional(),
  level: z.enum(["ALLOW", "ASK", "DENY"]),
});

function assertSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new OpenUseError("IPC_ERROR", "Unknown IPC sender.");
}

function publicSnapshot(): Promise<AppSnapshot> {
  return secrets.isConfigured().then((apiKeyConfigured) => ({
    settings: runtime.settings(apiKeyConfigured),
    engine: engine.status,
    qualification: { enabled: qualification.enabled, runId: qualification.runId, selfTest: qualificationSelfTest },
  }));
}

function installIpc(): void {
  ipcMain.handle("openuse:get-snapshot", async (event) => {
    assertSender(event);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-model", async (event, raw: unknown) => {
    assertSender(event);
    const { modelId } = modelSchema.parse(raw);
    if (!MODEL_CATALOG.some((model) => model.id === modelId)) throw new OpenUseError("MODEL_UNSUPPORTED", "Choose a model from the supported Computer Use catalog.");
    await settings.setModel(modelId);
  });
  ipcMain.handle("openuse:save-gateway-key", async (event, raw: unknown) => {
    assertSender(event);
    const { apiKey } = keySchema.parse(raw);
    await secrets.write(apiKey);
  });
  ipcMain.handle("openuse:test-gateway", async (event, raw: unknown) => {
    assertSender(event);
    const { modelId } = modelSchema.parse(raw);
    return testGatewayConnection(() => secrets.read(), modelId);
  });
  ipcMain.handle("openuse:self-test", async (event) => {
    assertSender(event);
    await publishNativeSelfTest();
  });
  ipcMain.handle("openuse:open-mac-privacy", async (event, raw: unknown) => {
    assertSender(event);
    const area = z.object({ area: z.enum(["accessibility", "screen-recording"]) }).parse(raw).area;
    if (process.platform !== "darwin") throw new OpenUseError("UNSUPPORTED_ACTION", "macOS privacy settings are only available on macOS.");
    const url = area === "accessibility"
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      : "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    await shell.openExternal(url);
  });
  ipcMain.handle("openuse:start-task", async (event, raw: unknown) => {
    assertSender(event);
    const { command } = taskSchema.parse(raw);
    await runtime.start(command);
  });
  ipcMain.handle("openuse:stop-task", async (event) => {
    assertSender(event);
    await runtime.stop();
  });
  ipcMain.handle("openuse:permission-decision", async (event, raw: unknown) => {
    assertSender(event);
    const { id, decision } = permissionDecisionSchema.parse(raw) as { id: string; decision: PermissionDecision };
    runtime.decidePermission(id, decision);
  });
  ipcMain.handle("openuse:set-app-permission", async (event, raw: unknown) => {
    assertSender(event);
    const { appName, appIdentity, level } = appPermissionSchema.parse(raw) as { appName: string; appIdentity?: string; level: PermissionLevel };
    await runtime.setPermission(appName, level, appIdentity);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0d0f10",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = undefined; });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  await settings.initialize();
  secrets = new GatewaySecretStore(join(app.getPath("userData"), "secrets.json"), safeStorage);
  qualification = new QualificationRecorder({
    enabled: process.env.OPENUSE_QUALIFICATION_MODE === "1",
    directory: process.env.OPENUSE_QUALIFICATION_DIR,
    runId: process.env.OPENUSE_QUALIFICATION_RUN_ID,
  });
  engine = new NativeEngineProcess({
    platform: process.platform,
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  runtime = new TaskRuntime({
    settings,
    engine,
    readApiKey: () => secrets.read(),
    emit: (event) => {
      qualification.record(event);
      logRuntimeEvent(event, !app.isPackaged);
      mainWindow?.webContents.send("openuse:event", event);
    },
    qualificationMode: qualification.enabled,
  });
  installIpc();
  createWindow();
  // macOS self-tests run on every desktop launch so the UI can distinguish a
  // missing Accessibility/Screen Recording grant from an offline controller.
  // Windows keeps the existing qualification-only behavior to avoid changing
  // its normal startup path.
  if (process.platform === "darwin" || (qualification.enabled && process.platform === "win32")) void publishNativeSelfTest();
}

async function publishNativeSelfTest(): Promise<void> {
  let result: EngineSelfTestResult;
  try {
    result = await engine.selfTest();
  } catch (error) {
    result = {
      ok: false,
      uiAutomationAvailable: false,
      windowEnumerationAvailable: false,
      screenEnumerationAvailable: false,
      screenshotAvailable: false,
      dpiAvailable: false,
      inputApisAvailable: false,
      monitorCount: 0,
      monitors: [],
      platform: process.platform,
      detail: error instanceof Error ? error.message : "The native self-test failed.",
    };
  }
  qualificationSelfTest = result;
  const event: RuntimeEvent = { type: "qualification.self-test", result, at: nowIso() };
  qualification.recordSelfTest(result);
  logRuntimeEvent(event, !app.isPackaged);
  mainWindow?.webContents.send("openuse:event", event);
  const statusEvent: RuntimeEvent = { type: "engine.status", status: engine.status, at: nowIso() };
  qualification.record(statusEvent);
  mainWindow?.webContents.send("openuse:event", statusEvent);
}

void bootstrap().catch((error) => {
  console.error("OpenUse failed to start:", error instanceof Error ? error.message : "unknown error");
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void (async () => {
    await runtime?.stop();
    await engine?.shutdown();
    app.quit();
  })();
});
