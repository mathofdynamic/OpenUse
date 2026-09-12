import { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import { z } from "zod";
import type { Locale, NamedProviderId, PermissionDecision, PermissionLevel, RuntimeEvent } from "@openuse/shared";
import { OpenUseError, nowIso, type AppSnapshot, type EngineSelfTestResult } from "@openuse/shared";
import { testGatewayConnection } from "@openuse/ai";
import { GatewaySecretStore } from "./secure-store";
import { SettingsStore } from "./settings-store";
import { NativeEngineProcess } from "./native-process";
import { TaskRuntime } from "./task-runtime";
import { logRuntimeEvent } from "./runtime-logger";
import { QualificationRecorder } from "./qualification-recorder";
import { ModelCatalogStore } from "./model-catalog-store";
import { UsageStore } from "./usage-store";
import { CursorOverlayManager } from "./cursor-overlay";
import { ThreadStore } from "./thread-store";
import { NamedProviderManager } from "./named-provider-runtime";

let mainWindow: BrowserWindow | undefined;
let settings: SettingsStore;
let secrets: GatewaySecretStore;
let engine: NativeEngineProcess;
let runtime: TaskRuntime;
let qualification: QualificationRecorder;
let modelCatalog: ModelCatalogStore;
let usage: UsageStore;
let threads: ThreadStore;
let cursorOverlay: CursorOverlayManager | undefined;
let namedProviders: NamedProviderManager;
let qualificationSelfTest: EngineSelfTestResult | undefined;
let isQuitting = false;

const modelSchema = z.object({ modelId: z.string().min(1).max(160) });
const keySchema = z.object({ apiKey: z.string().trim().min(1).max(500) });
const taskSchema = z.object({ command: z.string().trim().min(1).max(10_000), threadId: z.string().trim().min(1).max(120).optional() });
const threadIdSchema = z.object({ threadId: z.string().trim().min(1).max(120) });
const threadFolderSchema = z.object({ name: z.string().trim().min(1).max(80) });
const moveThreadSchema = z.object({ threadId: z.string().trim().min(1).max(120), folderId: z.string().trim().min(1).max(120).optional() });
const permissionDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["allow-once", "always-allow", "deny"]),
});
const appPermissionSchema = z.object({
  appName: z.string().trim().min(1).max(160),
  appIdentity: z.string().trim().min(1).max(240).optional(),
  level: z.enum(["ALLOW", "ASK", "DENY"]),
});
const providerSchema = z.object({ provider: z.enum(["vercel-gateway", "custom-openai-compatible", "codex", "claude", "opencode"]) });
const namedProviderSchema = z.object({
  provider: z.enum(["codex", "claude", "opencode"]),
  executablePath: z.string().trim().max(500).optional(),
  modelId: z.string().trim().max(240).optional(),
});
const localeSchema = z.object({ locale: z.enum(["en", "fa"]) });
const reasoningSchema = z.object({ reasoningEffort: z.enum(["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"]) });
const appearanceSchema = z.object({
  primaryColor: z.string().optional(),
  backgroundBlur: z.number().finite().optional(),
  backgroundOpacity: z.number().finite().optional(),
  showAgentCursor: z.boolean().optional(),
}).partial();
const customProviderSchema = z.object({
  baseUrl: z.string().trim().max(500).optional(),
  modelId: z.string().trim().max(240).optional(),
  capabilities: z.object({ toolCalling: z.boolean(), vision: z.boolean(), reasoning: z.boolean() }).optional(),
});

function installApplicationMenu(locale: Locale): void {
  const labels = locale === "fa"
    ? {
        file: "فایل", close: "بستن", quit: "خروج از OpenUse", edit: "ویرایش", undo: "بازگردانی", redo: "انجام دوباره",
        cut: "برش", copy: "رونوشت", paste: "چسباندن", selectAll: "انتخاب همه", view: "نمایش", reload: "بارگذاری مجدد",
        forceReload: "بارگذاری مجدد اجباری", devTools: "ابزارهای توسعه", resetZoom: "بازنشانی اندازه", zoomIn: "بزرگ‌نمایی",
        zoomOut: "کوچک‌نمایی", fullscreen: "تمام‌صفحه", window: "پنجره", minimize: "کمینه‌سازی", help: "راهنما",
      }
    : {
        file: "File", close: "Close", quit: "Quit OpenUse", edit: "Edit", undo: "Undo", redo: "Redo", cut: "Cut",
        copy: "Copy", paste: "Paste", selectAll: "Select All", view: "View", reload: "Reload", forceReload: "Force Reload",
        devTools: "Toggle Developer Tools", resetZoom: "Reset Zoom", zoomIn: "Zoom In", zoomOut: "Zoom Out",
        fullscreen: "Toggle Full Screen", window: "Window", minimize: "Minimize", help: "Help",
      };
  const template: MenuItemConstructorOptions[] = [
    {
      label: labels.file,
      submenu: [
        { role: "close", label: labels.close },
        ...(process.platform !== "darwin" ? [{ role: "quit", label: labels.quit } satisfies MenuItemConstructorOptions] : []),
      ],
    },
    {
      label: labels.edit,
      submenu: [
        { role: "undo", label: labels.undo },
        { role: "redo", label: labels.redo },
        { type: "separator" },
        { role: "cut", label: labels.cut },
        { role: "copy", label: labels.copy },
        { role: "paste", label: labels.paste },
        { role: "selectAll", label: labels.selectAll },
      ],
    },
    {
      label: labels.view,
      submenu: [
        { role: "reload", label: labels.reload },
        { role: "forceReload", label: labels.forceReload },
        { role: "toggleDevTools", label: labels.devTools },
        { type: "separator" },
        { role: "resetZoom", label: labels.resetZoom },
        { role: "zoomIn", label: labels.zoomIn },
        { role: "zoomOut", label: labels.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: labels.fullscreen },
      ],
    },
    {
      label: labels.window,
      submenu: [
        { role: "minimize", label: labels.minimize },
        { role: "close", label: labels.close },
      ],
    },
    { label: labels.help, submenu: [{ role: "toggleDevTools", label: labels.devTools }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function assertSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new OpenUseError("IPC_ERROR", "Unknown IPC sender.");
}

function publicSnapshot(): Promise<AppSnapshot> {
  return Promise.all([secrets.isConfigured(), secrets.isCustomConfigured()]).then(([apiKeyConfigured, customApiKeyConfigured]) => ({
    settings: runtime.settings(apiKeyConfigured, customApiKeyConfigured),
    engine: engine.status,
    qualification: { enabled: qualification.enabled, runId: qualification.runId, selfTest: qualificationSelfTest },
    modelCatalog: modelCatalog.snapshot(),
    usage: usage.snapshot(),
    threads: threads.snapshot(),
    namedProviders: namedProviders.snapshot(),
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
    if (!modelCatalog.snapshot().models.some((model) => model.id === modelId)) throw new OpenUseError("MODEL_UNSUPPORTED", "Choose a model from the current Gateway catalog.");
    await settings.setModel(modelId);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-provider", async (event, raw: unknown) => {
    assertSender(event);
    await settings.setProvider(providerSchema.parse(raw).provider);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-locale", async (event, raw: unknown) => {
    assertSender(event);
    const locale = localeSchema.parse(raw).locale;
    await settings.setLocale(locale);
    installApplicationMenu(locale);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-reasoning", async (event, raw: unknown) => {
    assertSender(event);
    await settings.setReasoningEffort(reasoningSchema.parse(raw).reasoningEffort);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-appearance", async (event, raw: unknown) => {
    assertSender(event);
    await settings.setAppearance(appearanceSchema.parse(raw));
    applyWindowsBackdropMaterial();
    cursorOverlay?.setAppearance({ color: settings.persisted.primaryColor, enabled: settings.persisted.showAgentCursor });
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-custom-provider", async (event, raw: unknown) => {
    assertSender(event);
    await settings.setCustomProvider(customProviderSchema.parse(raw));
    return publicSnapshot();
  });
  ipcMain.handle("openuse:set-named-provider", async (event, raw: unknown) => {
    assertSender(event);
    const input = namedProviderSchema.parse(raw);
    await settings.setNamedProvider(input.provider as NamedProviderId, { executablePath: input.executablePath, modelId: input.modelId });
    await settings.setProvider(input.provider as NamedProviderId);
    await namedProviders.refresh(input.provider as NamedProviderId);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:refresh-named-provider", async (event, raw: unknown) => {
    assertSender(event);
    const input = raw === undefined ? undefined : z.object({ provider: z.enum(["codex", "claude", "opencode"]) }).parse(raw).provider;
    await namedProviders.refresh(input);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:save-gateway-key", async (event, raw: unknown) => {
    assertSender(event);
    const { apiKey } = keySchema.parse(raw);
    await secrets.write(apiKey);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:save-custom-key", async (event, raw: unknown) => {
    assertSender(event);
    const { apiKey } = keySchema.parse(raw);
    await secrets.writeCustom(apiKey);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:test-gateway", async (event, raw: unknown) => {
    assertSender(event);
    const { modelId } = modelSchema.parse(raw);
    return testGatewayConnection(() => secrets.read(), modelId, undefined, modelCatalog.snapshot().models);
  });
  ipcMain.handle("openuse:refresh-model-catalog", async (event) => {
    assertSender(event);
    await modelCatalog.refresh();
    return publicSnapshot();
  });
  ipcMain.handle("openuse:reset-usage", async (event) => {
    assertSender(event);
    await usage.reset();
    return publicSnapshot();
  });
  ipcMain.handle("openuse:create-thread", async (event) => {
    assertSender(event);
    if (runtime.isRunning) throw new OpenUseError("UNSUPPORTED_ACTION", "Stop the current task before creating a thread.");
    await threads.createThread();
    return publicSnapshot();
  });
  ipcMain.handle("openuse:select-thread", async (event, raw: unknown) => {
    assertSender(event);
    if (runtime.isRunning) throw new OpenUseError("UNSUPPORTED_ACTION", "Stop the current task before changing threads.");
    await threads.selectThread(threadIdSchema.parse(raw).threadId);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:create-thread-folder", async (event, raw: unknown) => {
    assertSender(event);
    if (runtime.isRunning) throw new OpenUseError("UNSUPPORTED_ACTION", "Stop the current task before changing thread folders.");
    await threads.createFolder(threadFolderSchema.parse(raw).name);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:move-thread", async (event, raw: unknown) => {
    assertSender(event);
    if (runtime.isRunning) throw new OpenUseError("UNSUPPORTED_ACTION", "Stop the current task before changing thread folders.");
    const input = moveThreadSchema.parse(raw);
    await threads.moveThread(input.threadId, input.folderId);
    return publicSnapshot();
  });
  ipcMain.handle("openuse:window-minimize", (event) => {
    assertSender(event);
    mainWindow?.minimize();
  });
  ipcMain.handle("openuse:window-toggle-maximize", (event) => {
    assertSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle("openuse:window-close", (event) => {
    assertSender(event);
    mainWindow?.close();
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
  ipcMain.handle("openuse:relaunch", async (event) => {
    assertSender(event);
    if (process.platform !== "darwin") throw new OpenUseError("UNSUPPORTED_ACTION", "Relaunch is only available on macOS.");
    await runtime?.stop();
    await engine?.shutdown();
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("openuse:start-task", async (event, raw: unknown) => {
    assertSender(event);
    const { command, threadId } = taskSchema.parse(raw);
    await runtime.start(command, threadId);
  });
  ipcMain.handle("openuse:stop-task", async (event) => {
    assertSender(event);
    cursorOverlay?.hide();
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
    minWidth: 480,
    minHeight: 560,
    frame: false,
    autoHideMenuBar: process.platform === "win32",
    backgroundColor: "#00000000",
    transparent: false,
    roundedCorners: true,
    ...(process.platform === "darwin" ? { vibrancy: "under-window", visualEffectState: "active" } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (process.platform === "win32") {
    applyWindowsBackdropMaterial();
  }
  mainWindow.once("ready-to-show", () => focusMainWindow());
  const publishWindowState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("openuse:window-state", { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on("maximize", publishWindowState);
  mainWindow.on("unmaximize", publishWindowState);
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = undefined; cursorOverlay?.dispose(); cursorOverlay = undefined; });
  createCursorOverlay();
}

function applyWindowsBackdropMaterial(): void {
  if (process.platform !== "win32" || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setBackgroundMaterial(settings.persisted.backgroundBlur > 0 ? "acrylic" : "none");
  } catch {
    // Older Windows composition falls back to the renderer's neutral material.
  }
}

function createCursorOverlay(): void {
  if (cursorOverlay) return;
  cursorOverlay = new CursorOverlayManager({ rendererDirectory: join(__dirname, "renderer"), devServerUrl: process.env.VITE_DEV_SERVER_URL });
  cursorOverlay.create();
  cursorOverlay.setAppearance({ color: settings.persisted.primaryColor, enabled: settings.persisted.showAgentCursor });
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
  await settings.initialize();
  namedProviders = new NamedProviderManager(() => settings.persisted);
  installApplicationMenu(settings.persisted.locale);
  secrets = new GatewaySecretStore(join(app.getPath("userData"), "secrets.json"), safeStorage);
  modelCatalog = new ModelCatalogStore(join(app.getPath("userData"), "model-catalog.json"));
  await modelCatalog.initialize();
  usage = new UsageStore(join(app.getPath("userData"), "usage.json"));
  await usage.initialize();
  threads = new ThreadStore(join(app.getPath("userData"), "threads.json"));
  await threads.initialize();
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
    readCustomApiKey: () => secrets.readCustom(),
    getModels: () => modelCatalog.snapshot().models,
    usage,
    threads,
    namedProviders,
    emit: (event) => {
      qualification.record(event);
      logRuntimeEvent(event, !app.isPackaged);
      if (event.type === "cursor") cursorOverlay?.show(event.interaction, event.target);
      if (event.type === "task.started" || event.type === "task.finished") {
        if (event.type === "task.finished") cursorOverlay?.hideAfterTask();
        void publicSnapshot().then((snapshot) => mainWindow?.webContents.send("openuse:snapshot", snapshot));
        if (event.type === "task.finished" && (settings.persisted.provider === "codex" || settings.persisted.provider === "claude" || settings.persisted.provider === "opencode")) {
          void namedProviders.refresh(settings.persisted.provider).then(() => publicSnapshot()).then((snapshot) => mainWindow?.webContents.send("openuse:snapshot", snapshot)).catch(() => undefined);
        }
      }
      mainWindow?.webContents.send("openuse:event", event);
    },
    qualificationMode: qualification.enabled,
  });
  modelCatalog.onChange(() => {
    void publicSnapshot().then((snapshot) => mainWindow?.webContents.send("openuse:snapshot", snapshot));
  });
  installIpc();
  createWindow();
  void namedProviders.refresh().then(() => publicSnapshot()).then((snapshot) => mainWindow?.webContents.send("openuse:snapshot", snapshot)).catch(() => undefined);
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

app.on("activate", () => {
  if (!mainWindow) createWindow();
  else focusMainWindow();
});

app.on("before-quit", (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  void (async () => {
    await runtime?.stop();
    await usage?.flush();
    await threads?.flush();
    cursorOverlay?.hide();
    await engine?.shutdown();
    cursorOverlay?.dispose();
    app.quit();
  })();
});
