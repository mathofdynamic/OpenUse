import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react";
import { MODEL_CATALOG, estimateTwentyStepCost, getCompatibilityIssues, type GatewayConnectionResult } from "@openuse/ai";
import { defaultPermissionRecords } from "@openuse/permissions";
import type {
  AgentStatus,
  AppSettings,
  AppSnapshot,
  EngineSelfTestResult,
  EngineStatus,
  Locale,
  ModelCatalogStatus,
  ModelDefinition,
  PermissionDecision,
  PermissionLevel,
  PermissionRequest,
  QualificationSessionInfo,
  ReasoningEffort,
  RuntimeEvent,
  TimelineAction,
  ThreadFolder,
  ThreadRecord,
  ThreadSnapshot,
  UsageSummary,
} from "@openuse/shared";
import { formatDuration, formatMoney, formatNumber, formatPricePerMillion, localizeRuntimeText, platformName, providerLabel, reasoningLabel, starterCommands, statusLabel, translate } from "./i18n";

type TimelineEntry =
  | { kind: "user"; id: string; command: string }
  | { kind: "action"; action: TimelineAction };

type SettingsSection = "ai" | "appearance" | "usage" | "permissions" | "advanced";

const LocaleContext = createContext<Locale>("en");

function useTranslation() {
  const locale = useContext(LocaleContext);
  return { locale, t: (key: string, values?: Record<string, string | number>) => translate(locale, key, values) };
}

const emptyEngine: EngineStatus = { platform: "unknown", state: "offline", detail: "Connecting to the local runtime..." };
const emptySettings: AppSettings = {
  locale: "en",
  provider: "vercel-gateway",
  modelId: MODEL_CATALOG[0].id,
  apiKeyConfigured: false,
  permissions: [],
  reasoningEffort: "provider-default",
  primaryColor: "#c8f36a",
  backgroundBlur: 18,
  backgroundOpacity: 0.78,
  showAgentCursor: true,
  customProvider: { baseUrl: "http://localhost:11434/v1", modelId: "llama3.2-vision", apiKeyConfigured: false, capabilities: { toolCalling: false, vision: false, reasoning: false } },
};
const emptyUsage: UsageSummary = {
  totalKnownSpend: 0,
  totalTasks: 0,
  completedTasks: 0,
  inputTokens: 0,
  outputTokens: 0,
  knownCostRequests: 0,
  unpricedRequests: 0,
  modelUsage: [],
};
const emptyCatalogStatus: ModelCatalogStatus = { source: "bundled-fallback", isRefreshing: false, count: MODEL_CATALOG.length };
const emptyQualification: QualificationSessionInfo = { enabled: false };
const emptyThreadSnapshot: ThreadSnapshot = {
  currentThreadId: "preview-thread",
  folders: [],
  threads: [{ id: "preview-thread", title: "New thread", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), tasks: [] }],
};

const emptySnapshot: AppSnapshot = {
  settings: { ...emptySettings, permissions: defaultPermissionRecords() },
  engine: { ...emptyEngine, platform: "browser-preview", state: "unsupported", detail: "The desktop bridge is available inside Electron only." },
  qualification: emptyQualification,
  modelCatalog: { models: MODEL_CATALOG, status: emptyCatalogStatus },
  usage: emptyUsage,
  threads: emptyThreadSnapshot,
};

let browserPreviewSnapshot = emptySnapshot;

const browserPreviewBridge: Window["openuse"] = {
  getSnapshot: async () => browserPreviewSnapshot,
  setModel: async (modelId) => {
    browserPreviewSnapshot = { ...browserPreviewSnapshot, settings: { ...browserPreviewSnapshot.settings, modelId } };
    return browserPreviewSnapshot;
  },
  setProvider: async (provider) => {
    browserPreviewSnapshot = { ...browserPreviewSnapshot, settings: { ...browserPreviewSnapshot.settings, provider } };
    return browserPreviewSnapshot;
  },
  setLocale: async (nextLocale) => {
    browserPreviewSnapshot = { ...browserPreviewSnapshot, settings: { ...browserPreviewSnapshot.settings, locale: nextLocale } };
    return browserPreviewSnapshot;
  },
  setReasoningEffort: async (reasoningEffort) => {
    browserPreviewSnapshot = { ...browserPreviewSnapshot, settings: { ...browserPreviewSnapshot.settings, reasoningEffort } };
    return browserPreviewSnapshot;
  },
  setAppearance: async (patch) => {
    browserPreviewSnapshot = { ...browserPreviewSnapshot, settings: { ...browserPreviewSnapshot.settings, ...patch } };
    return browserPreviewSnapshot;
  },
  setCustomProvider: async () => emptySnapshot,
  saveGatewayApiKey: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  saveCustomApiKey: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  testGatewayConnection: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  runSelfTest: async () => { throw new Error("Diagnostics are available in the OpenUse desktop app."); },
  openMacPrivacy: async () => { throw new Error("macOS privacy settings are available in the OpenUse desktop app."); },
  relaunch: async () => { throw new Error("Relaunch is available in the OpenUse desktop app."); },
  startTask: async () => { throw new Error("Computer control is available in the OpenUse desktop app."); },
  createThread: async () => {
    const timestamp = new Date().toISOString();
    const thread = { id: `preview-thread-${Date.now()}`, title: "New thread", createdAt: timestamp, updatedAt: timestamp, tasks: [] } satisfies ThreadRecord;
    browserPreviewSnapshot = { ...browserPreviewSnapshot, threads: { ...browserPreviewSnapshot.threads, currentThreadId: thread.id, threads: [thread, ...browserPreviewSnapshot.threads.threads] } };
    return browserPreviewSnapshot;
  },
  selectThread: async (threadId) => {
    if (!browserPreviewSnapshot.threads.threads.some((thread) => thread.id === threadId)) throw new Error("The selected thread no longer exists.");
    browserPreviewSnapshot = { ...browserPreviewSnapshot, threads: { ...browserPreviewSnapshot.threads, currentThreadId: threadId } };
    return browserPreviewSnapshot;
  },
  createThreadFolder: async (name) => {
    const timestamp = new Date().toISOString();
    const folder = { id: `preview-folder-${Date.now()}`, name: name.trim(), createdAt: timestamp, updatedAt: timestamp } satisfies ThreadFolder;
    browserPreviewSnapshot = { ...browserPreviewSnapshot, threads: { ...browserPreviewSnapshot.threads, folders: [...browserPreviewSnapshot.threads.folders, folder] } };
    return browserPreviewSnapshot;
  },
  moveThread: async (threadId, folderId) => {
    browserPreviewSnapshot = { ...browserPreviewSnapshot, threads: { ...browserPreviewSnapshot.threads, threads: browserPreviewSnapshot.threads.threads.map((thread) => {
      if (thread.id !== threadId || folderId) return thread.id === threadId ? { ...thread, ...(folderId ? { folderId } : {}) } : thread;
      const { folderId: _folderId, ...unfiled } = thread;
      return unfiled;
    }) } };
    return browserPreviewSnapshot;
  },
  stopTask: async () => undefined,
  refreshModelCatalog: async () => emptySnapshot,
  resetUsage: async () => emptySnapshot,
  minimizeWindow: async () => undefined,
  toggleMaximizeWindow: async () => false,
  closeWindow: async () => undefined,
  onWindowState: () => () => undefined,
  decidePermission: async () => undefined,
  setAppPermission: async () => undefined,
  onEvent: () => () => undefined,
  onSnapshot: () => () => undefined,
};

const runtimeApi = window.openuse ?? browserPreviewBridge;

export function App() {
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [engine, setEngine] = useState<EngineStatus>(emptyEngine);
  const [models, setModels] = useState<ModelDefinition[]>(MODEL_CATALOG);
  const [catalogStatus, setCatalogStatus] = useState<ModelCatalogStatus>(emptyCatalogStatus);
  const [usage, setUsage] = useState<UsageSummary>(emptyUsage);
  const [threadSnapshot, setThreadSnapshot] = useState<ThreadSnapshot>(emptyThreadSnapshot);
  const [selfTest, setSelfTest] = useState<EngineSelfTestResult | undefined>();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [step, setStep] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [taskCost, setTaskCost] = useState(0);
  const [permission, setPermission] = useState<PermissionRequest | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [customKeyDraft, setCustomKeyDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [connectionTest, setConnectionTest] = useState<ConnectionTestState>("idle");
  const [threadPanelOpen, setThreadPanelOpen] = useState(false);
  const [folderFilter, setFolderFilter] = useState("all");
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [currentTaskId, setCurrentTaskId] = useState<string | undefined>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const appearanceRevision = useRef(0);
  const locale = settings.locale ?? "en";
  const t = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  }, [locale]);

  function applySnapshot(snapshot: AppSnapshot) {
    setSettings(snapshot.settings);
    setEngine(snapshot.engine);
    setSelfTest(snapshot.qualification.selfTest);
    setModels(snapshot.modelCatalog.models);
    setCatalogStatus(snapshot.modelCatalog.status);
    setUsage(snapshot.usage);
    setThreadSnapshot(snapshot.threads);
  }

  useEffect(() => {
    void runtimeApi.getSnapshot().then(applySnapshot).catch(() => setError("OpenUse could not load its local settings."));
    const unsubscribeEvent = runtimeApi.onEvent((event) => handleRuntimeEvent(event, {
      setEntries,
      setStatus,
      setStep,
      setActionCount,
      setTaskCost,
      setUsage,
      setPermission,
      setEngine,
      setError,
      setSelfTest,
      setCurrentTaskId,
    }));
    const unsubscribeSnapshot = runtimeApi.onSnapshot(applySnapshot);
    return () => { unsubscribeEvent(); unsubscribeSnapshot(); };
  }, []);

  const activeModel = useMemo(() => {
    if (settings.provider === "custom-openai-compatible") {
      return {
        id: settings.customProvider.modelId,
        label: settings.customProvider.modelId || t("Custom model"),
        provider: "custom-openai-compatible" as const,
        sourceProvider: "Custom endpoint",
        capabilities: settings.customProvider.capabilities,
      } satisfies ModelDefinition;
    }
    return models.find((model) => model.id === settings.modelId) ?? {
      id: settings.modelId,
      label: settings.modelId,
      provider: "vercel-gateway" as const,
      capabilities: { toolCalling: false, vision: false },
    } satisfies ModelDefinition;
  }, [models, settings]);
  const currentThread = threadSnapshot.threads.find((thread) => thread.id === threadSnapshot.currentThreadId) ?? threadSnapshot.threads[0] ?? emptyThreadSnapshot.threads[0];
  const currentFolder = currentThread.folderId ? threadSnapshot.folders.find((folder) => folder.id === currentThread.folderId) : undefined;
  const compatible = getCompatibilityIssues(activeModel).length === 0;
  const isRunning = status === "running";
  const engineCanStart = engine.state === "ready" || engine.canStart === true;
  const platformLabel = platformName(locale, engine.platform);
  const starterCommandList = starterCommands(locale, engine.platform);
  const nativePermissionsReady = engine.platform !== "darwin" || selfTest?.ok === true;
  const controlReady = engine.state === "ready" && nativePermissionsReady;
  const providerConfigured = settings.provider === "vercel-gateway" ? settings.apiKeyConfigured : Boolean(settings.customProvider.baseUrl && settings.customProvider.modelId);
  const canRun = Boolean(command.trim()) && !isRunning && providerConfigured && compatible && engineCanStart && nativePermissionsReady;
  const effectiveReasoning = activeModel.capabilities.reasoning && activeModel.capabilities.reasoningEfforts?.includes(settings.reasoningEffort)
    ? settings.reasoningEffort
    : "provider-default";
  const appStyle = {
    "--primary": settings.primaryColor,
    "--primary-foreground": primaryForeground(settings.primaryColor),
    "--primary-muted": `color-mix(in srgb, ${settings.primaryColor} 14%, transparent)`,
    "--surface-alpha": String(settings.backgroundOpacity),
    "--background-blur": `${settings.backgroundBlur}px`,
  } as CSSProperties;

  async function runTask() {
    if (!canRun) {
      if (!providerConfigured) {
        setSettingsOpen(true);
        setError(settings.provider === "vercel-gateway" ? "Add an AI Gateway key in Settings to run a task." : "Configure the custom endpoint before running a task.");
      } else if (!engineCanStart) setError(engine.detail || `${platformLabel} control is not available on this host.`);
      else if (!nativePermissionsReady) setError(selfTest?.detail ?? "Grant the required macOS privacy permissions before running Computer Use.");
      else if (!compatible) setError(`Choose a model with ${getCompatibilityIssues(activeModel).join(" and ")} for Computer Use.`);
      return;
    }
    setError(undefined);
    setEntries([]);
    setStep(0);
    setActionCount(0);
    setTaskCost(0);
    try {
      await runtimeApi.startTask(command.trim(), threadSnapshot.currentThreadId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OpenUse could not start the task.");
    }
  }

  async function stopTask() {
    try { await runtimeApi.stopTask(); } catch (caught) { setError(caught instanceof Error ? caught.message : "OpenUse could not stop the task."); }
  }

  async function saveGateway(modelId: string) {
    try {
      let snapshot = await runtimeApi.setModel(modelId);
      if (apiKeyDraft.trim()) snapshot = await runtimeApi.saveGatewayApiKey(apiKeyDraft.trim());
      applySnapshot(snapshot);
      setApiKeyDraft("");
      setSettingsOpen(false);
      setConnectionTest("idle");
      setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Gateway settings could not be saved."); }
  }

  async function saveCustomProvider(input: { baseUrl: string; modelId: string; capabilities: { toolCalling: boolean; vision: boolean; reasoning: boolean } }) {
    try {
      let snapshot = await runtimeApi.setCustomProvider(input);
      if (customKeyDraft.trim()) snapshot = await runtimeApi.saveCustomApiKey(customKeyDraft.trim());
      snapshot = await runtimeApi.setProvider("custom-openai-compatible");
      applySnapshot(snapshot);
      setCustomKeyDraft("");
      setError(undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Custom provider settings could not be saved."); }
  }

  async function testConnection(modelId: string) {
    setConnectionTest("testing");
    try {
      let snapshot: AppSnapshot | undefined;
      if (apiKeyDraft.trim()) snapshot = await runtimeApi.saveGatewayApiKey(apiKeyDraft.trim());
      const result = await runtimeApi.testGatewayConnection(modelId);
      setConnectionTest(result);
      if (snapshot) applySnapshot(snapshot);
      else applySnapshot(await runtimeApi.getSnapshot());
    } catch (caught) { setConnectionTest({ ok: false, code: "GATEWAY_ERROR", message: caught instanceof Error ? caught.message : "The Gateway connection test failed." }); }
  }

  function updateAppearance(patch: { primaryColor?: string; backgroundBlur?: number; backgroundOpacity?: number; showAgentCursor?: boolean }) {
    const revision = ++appearanceRevision.current;
    setSettings((current) => ({ ...current, ...patch }));
    void runtimeApi.setAppearance(patch).then((snapshot) => {
      if (revision === appearanceRevision.current) applySnapshot(snapshot);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Appearance could not be saved."));
  }

  function updateLocale(nextLocale: Locale) {
    setSettings((current) => ({ ...current, locale: nextLocale }));
    void runtimeApi.setLocale(nextLocale).then(applySnapshot).catch((caught) => setError(caught instanceof Error ? caught.message : "Language could not be saved."));
  }

  function updateReasoning(reasoningEffort: ReasoningEffort) {
    void runtimeApi.setReasoningEffort(reasoningEffort).then(applySnapshot).catch((caught) => setError(caught instanceof Error ? caught.message : "Reasoning setting could not be saved."));
  }

  async function updatePermission(appName: string, level: PermissionLevel, appIdentity?: string) {
    await runtimeApi.setAppPermission(appName, level, appIdentity);
    applySnapshot(await runtimeApi.getSnapshot());
  }

  function resetActivityForThread(snapshot: ThreadSnapshot) {
    const selected = snapshot.threads.find((thread) => thread.id === snapshot.currentThreadId);
    const latest = selected?.tasks.at(-1);
    setEntries([]);
    setCurrentTaskId(undefined);
    setCommand("");
    setStep(latest?.steps ?? 0);
    setActionCount(latest?.actions ?? 0);
    setTaskCost(latest?.knownCost ?? 0);
    setStatus(latest?.status === "completed" || latest?.status === "stopped" || latest?.status === "error" ? latest.status : "idle");
  }

  async function createNewThread() {
    if (isRunning) return;
    try {
      const snapshot = await runtimeApi.createThread();
      applySnapshot(snapshot);
      resetActivityForThread(snapshot.threads);
      setThreadPanelOpen(false);
      composerRef.current?.focus();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "A new thread could not be created."); }
  }

  async function selectThread(threadId: string) {
    if (isRunning) return;
    try {
      const snapshot = await runtimeApi.selectThread(threadId);
      applySnapshot(snapshot);
      resetActivityForThread(snapshot.threads);
      setThreadPanelOpen(false);
      composerRef.current?.focus();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The thread could not be opened."); }
  }

  async function createThreadFolder() {
    const name = folderNameDraft.trim();
    if (!name) return;
    try {
      const snapshot = await runtimeApi.createThreadFolder(name);
      applySnapshot(snapshot);
      setFolderNameDraft("");
      setFolderFormOpen(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The thread folder could not be created."); }
  }

  async function moveThread(threadId: string, folderId: string) {
    try {
      applySnapshot(await runtimeApi.moveThread(threadId, folderId === "none" ? undefined : folderId));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The thread could not be moved."); }
  }

  function useStarter(value: string) {
    setCommand(value);
    composerRef.current?.focus();
  }

  return (
    <LocaleContext.Provider value={locale}>
    <div className={`app-window ${locale === "fa" ? "app-window-rtl" : ""}`} dir={locale === "fa" ? "rtl" : "ltr"} lang={locale} style={appStyle}>
      <WindowTitleBar />
      <div className={`app-shell ${locale === "fa" ? "app-shell-rtl" : ""}`} dir={locale === "fa" ? "rtl" : "ltr"}>
      <div className="material-layer" aria-hidden="true" />
      <aside className="side-rail" aria-label={t("OpenUse navigation")}>
        <BrandLockup />
        <div className="rail-section">
          <div className="rail-label">{t("Workspace")}</div>
          <button className="rail-link rail-link-active" type="button"><Glyph name="activity" /><span>{t("Control room")}</span></button>
          <button className="rail-link" type="button" disabled={isRunning} onClick={() => setSettingsOpen(true)}><Glyph name="sliders" /><span>{t("Settings")}</span></button>
        </div>
        <div className="rail-spacer" />
        <div className="rail-note">
          <div className="rail-note-heading"><span className={`status-dot ${controlReady ? "status-ready" : `status-${engine.state}`}`} />{t("Local runtime")}</div>
          <p>{controlReady ? t("{platform} control is connected.", { platform: platformLabel }) : engine.platform === "darwin" && selfTest && !selfTest.ok ? t("macOS permissions are required.") : localizeRuntimeText(locale, engine.detail)}</p>
          <div className="rail-version">{t("OpenUse 0.2.0 / {platform}", { platform: platformLabel })}</div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar app-header" aria-label={t("OpenUse header")}>
          <div className="topbar-brand"><div className="brand-mark small" aria-hidden="true"><span /></div><div><div className="topbar-brand-name">OpenUse</div><div className="topbar-brand-caption">{t("Control room")}</div></div></div>
          <div className="topbar-context"><span className={`status-dot ${controlReady ? "status-ready" : `status-${engine.state}`}`} /><span>{controlReady ? t("{platform} control ready", { platform: platformLabel }) : engine.platform === "darwin" && selfTest && !selfTest.ok ? t("{platform} permission required", { platform: platformLabel }) : engine.state === "unsupported" ? t("{platform} control unavailable", { platform: platformLabel }) : t("{platform} control offline", { platform: platformLabel })}</span></div>
          <div className="topbar-actions">
            <ModelPicker models={models} value={settings.provider === "vercel-gateway" ? settings.modelId : settings.customProvider.modelId} onSelect={(modelId) => { if (settings.provider === "vercel-gateway") void runtimeApi.setModel(modelId).then(applySnapshot); }} compact disabled={isRunning || settings.provider !== "vercel-gateway"} />
            <div className="topbar-reasoning"><span>{t("Reasoning")}</span><ReasoningSelect model={activeModel} value={effectiveReasoning} onChange={updateReasoning} compact disabled={isRunning} /></div>
            <SpendPill taskCost={taskCost} total={usage.totalKnownSpend} />
            <button className="icon-button" type="button" aria-label={t("Open Settings")} disabled={isRunning} onClick={() => setSettingsOpen(true)}><Glyph name="sliders" /></button>
          </div>
        </header>

        <div className="compact-nav" aria-label={t("Compact navigation")}><button className="compact-nav-active" type="button"><Glyph name="activity" />{t("Activity")}</button><button type="button" disabled={isRunning} onClick={() => setSettingsOpen(true)}><Glyph name="sliders" />{t("Settings")}</button></div>

        <div className="thread-toolbar-wrap">
          <ThreadToolbar thread={currentThread} folder={currentFolder} open={threadPanelOpen} onToggle={() => setThreadPanelOpen((current) => !current)} onNew={createNewThread} />
          {threadPanelOpen && <ThreadPanel snapshot={threadSnapshot} selectedFolder={folderFilter} folderFormOpen={folderFormOpen} folderName={folderNameDraft} onFolderFilter={setFolderFilter} onFolderForm={() => setFolderFormOpen((current) => !current)} onFolderName={setFolderNameDraft} onCreateFolder={() => void createThreadFolder()} onCancelFolder={() => { setFolderFormOpen(false); setFolderNameDraft(""); }} onSelectThread={(threadId) => void selectThread(threadId)} onMoveThread={(threadId, folderId) => void moveThread(threadId, folderId)} onNew={createNewThread} />}
        </div>

        <div className="content-wrap">
          {error && <div className="inline-alert" role="alert"><Glyph name="alert" /><span>{localizeRuntimeText(locale, error)}</span><button type="button" onClick={() => setError(undefined)} aria-label={t("Dismiss error")}>x</button></div>}
          {engine.platform === "darwin" && selfTest && !selfTest.ok && <MacPermissionSetup selfTest={selfTest} />}

          <div className="workspace-grid">
            <section className="activity-surface" aria-labelledby="activity-heading">
              <div className="surface-header"><h1 className="activity-heading" id="activity-heading">{t("Activity")}</h1><div className={`state-badge state-${status}`}><span className="state-pulse" />{statusLabel(locale, status)}</div></div>
              <div className={`timeline ${entries.length === 0 ? "timeline-empty" : ""}`} aria-live="polite">{entries.length === 0 ? currentThread.tasks.length > 0 ? <ThreadHistory thread={currentTaskId ? { ...currentThread, tasks: currentThread.tasks.filter((task) => task.id !== currentTaskId) } : currentThread} onContinue={() => { setCommand(""); composerRef.current?.focus(); }} /> : <EmptyActivity commands={starterCommandList} onStarter={useStarter} /> : entries.map((entry) => entry.kind === "user" ? <UserEntry key={entry.id} command={entry.command} /> : <ActionEntry key={entry.action.actionId} action={entry.action} />)}</div>
              <div className="activity-footer">
                <div className="activity-metrics"><span>{isRunning ? <><span className="spinner" />{t("Step {step} / {actions} actions", { step: step || 1, actions: actionCount })}</> : t("{count} actions", { count: actionCount })}</span><span>{t("Task spend")} <strong>{formatMoney(locale, taskCost)}</strong></span><span>{t("20-step estimate")} <Estimate model={activeModel} usage={usage} /></span></div>
                <div className="composer"><textarea ref={composerRef} value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runTask(); }} placeholder={t("Tell OpenUse what to do...")} aria-label={t("Task command")} rows={2} disabled={isRunning} /><div className="composer-bottom"><span className="composer-hint">{t("Ctrl + Enter to run")}</span>{isRunning ? <button className="stop-button" type="button" onClick={() => void stopTask()}><span className="stop-square" />{t("Stop task")}</button> : <button className="run-button" type="button" disabled={!command.trim()} onClick={() => void runTask()}><span>{t("Run task")}</span><Glyph name="arrow" /></button>}</div></div>
              </div>
            </section>

          </div>
        </div>
      </main>

      {permission && <PermissionDialog request={permission} onDecision={(decision) => { void runtimeApi.decidePermission(permission.id, decision); setPermission(undefined); }} onStop={() => { setPermission(undefined); void stopTask(); }} />}
      {settingsOpen && <SettingsDialog settings={settings} models={models} catalogStatus={catalogStatus} usage={usage} apiKeyDraft={apiKeyDraft} customKeyDraft={customKeyDraft} onApiKeyChange={setApiKeyDraft} onCustomKeyChange={setCustomKeyDraft} onClose={() => setSettingsOpen(false)} onSaveGateway={(modelId) => void saveGateway(modelId)} onSaveCustom={saveCustomProvider} onTestConnection={(modelId) => void testConnection(modelId)} connectionTest={connectionTest} onProvider={(provider) => void runtimeApi.setProvider(provider).then(applySnapshot)} onLocale={updateLocale} onReasoning={updateReasoning} onAppearance={updateAppearance} onRefreshModels={() => void runtimeApi.refreshModelCatalog().then(applySnapshot)} onResetUsage={() => void runtimeApi.resetUsage().then(applySnapshot)} onPermissionChange={(appName, level, appIdentity) => void updatePermission(appName, level, appIdentity)} onRunSelfTest={() => void runtimeApi.runSelfTest()} onOpenMacPrivacy={(area) => void runtimeApi.openMacPrivacy(area)} />}
      </div>
    </div>
    </LocaleContext.Provider>
  );
}

function WindowTitleBar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => runtimeApi.onWindowState((state) => setMaximized(state.maximized)), []);

  return <header className="window-titlebar" aria-label={t("Window controls")}>
    <div className="window-titlebar-drag" onDoubleClick={() => void runtimeApi.toggleMaximizeWindow()}>
      <div className="window-titlebar-brand"><div className="brand-mark window-titlebar-mark" aria-hidden="true"><span /></div><div className="window-titlebar-name">OpenUse</div></div>
    </div>
    <div className="window-controls" aria-label={t("Window controls")}>
      <button className="window-control" type="button" aria-label={t("Minimize window")} onClick={() => void runtimeApi.minimizeWindow()}><Glyph name="minus" /></button>
      <button className="window-control" type="button" aria-label={t(maximized ? "Restore window" : "Maximize window")} onClick={() => void runtimeApi.toggleMaximizeWindow().then(setMaximized)}><Glyph name={maximized ? "restore" : "square"} /></button>
      <button className="window-control window-control-close" type="button" aria-label={t("Close window")} onClick={() => void runtimeApi.closeWindow()}><Glyph name="close" /></button>
    </div>
  </header>;
}

function handleRuntimeEvent(event: RuntimeEvent, setters: {
  setEntries: Dispatch<SetStateAction<TimelineEntry[]>>;
  setStatus: Dispatch<SetStateAction<AgentStatus>>;
  setStep: Dispatch<SetStateAction<number>>;
  setActionCount: Dispatch<SetStateAction<number>>;
  setTaskCost: Dispatch<SetStateAction<number>>;
  setUsage: Dispatch<SetStateAction<UsageSummary>>;
  setPermission: Dispatch<SetStateAction<PermissionRequest | undefined>>;
    setEngine: Dispatch<SetStateAction<EngineStatus>>;
    setError: Dispatch<SetStateAction<string | undefined>>;
    setSelfTest: Dispatch<SetStateAction<EngineSelfTestResult | undefined>>;
    setCurrentTaskId: Dispatch<SetStateAction<string | undefined>>;
}) {
  switch (event.type) {
    case "task.started":
      setters.setCurrentTaskId(event.taskId);
      setters.setStatus("running");
      setters.setTaskCost(0);
      setters.setEntries([{ kind: "user", id: `user-${event.taskId}`, command: event.command }]);
      break;
    case "agent.step": setters.setStep(event.step); setters.setActionCount(event.actionCount); break;
    case "action.started": setters.setEntries((current) => [...current, { kind: "action", action: event.action }]); break;
    case "permission.requested": setters.setPermission(event.request); break;
    case "permission.resolved": break;
    case "model.usage": setters.setTaskCost(event.taskCost); setters.setUsage((current) => ({ ...current, totalKnownSpend: event.lifetimeSpend })); break;
    case "cursor": break;
    case "action.completed": setters.setEntries((current) => current.map((entry) => entry.kind === "action" && entry.action.actionId === event.actionId ? { ...entry, action: { ...entry.action, status: "completed", durationMs: event.durationMs, detail: event.detail, ...event.telemetry } } : entry)); break;
    case "action.failed": setters.setEntries((current) => current.map((entry) => entry.kind === "action" && entry.action.actionId === event.actionId ? { ...entry, action: { ...entry.action, status: "failed", durationMs: event.durationMs, errorCode: event.code, errorMessage: event.message, ...event.telemetry } } : entry)); break;
    case "task.finished": setters.setStatus(event.status); if (event.status === "error") setters.setError(event.summary); break;
    case "engine.status": setters.setEngine(event.status); break;
    case "qualification.self-test": setters.setSelfTest(event.result); break;
  }
}

function ThreadToolbar({ thread, folder, open, onToggle, onNew }: { thread: ThreadRecord; folder?: ThreadFolder; open: boolean; onToggle(): void; onNew(): void }) {
  const { t } = useTranslation();
  return <div className="thread-toolbar" aria-label={t("Thread management")}>
    <button className="thread-switcher-trigger" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}>
      <span className="thread-switcher-icon"><Glyph name="activity" /></span>
      <span className="thread-switcher-copy"><small>{t("Thread")}</small><strong>{thread.title}</strong><em>{folder?.name ?? t("Unfiled")}</em></span>
      <Glyph name="chevron" />
    </button>
    <button className="thread-new-button" type="button" onClick={onNew}><Glyph name="plus" />{t("New thread")}</button>
  </div>;
}

function ThreadPanel({ snapshot, selectedFolder, folderFormOpen, folderName, onFolderFilter, onFolderForm, onFolderName, onCreateFolder, onCancelFolder, onSelectThread, onMoveThread, onNew }: {
  snapshot: ThreadSnapshot;
  selectedFolder: string;
  folderFormOpen: boolean;
  folderName: string;
  onFolderFilter(folderId: string): void;
  onFolderForm(): void;
  onFolderName(value: string): void;
  onCreateFolder(): void;
  onCancelFolder(): void;
  onSelectThread(threadId: string): void;
  onMoveThread(threadId: string, folderId: string): void;
  onNew(): void;
}) {
  const { locale, t } = useTranslation();
  const visibleThreads = snapshot.threads.filter((thread) => selectedFolder === "all" || thread.folderId === selectedFolder);
  const folderOptions: ThemedSelectOption[] = [{ value: "none", label: t("No folder") }, ...snapshot.folders.map((folder) => ({ value: folder.id, label: folder.name }))];
  return <section className="thread-panel" role="dialog" aria-label={t("Threads")}>
    <div className="thread-panel-header"><div><div className="dialog-eyebrow">{t("Threads")}</div><strong>{t("Continue work without losing the thread.")}</strong></div><button className="secondary-action thread-folder-button" type="button" onClick={onFolderForm}><Glyph name="plus" />{t("New folder")}</button></div>
    {folderFormOpen && <form className="thread-folder-form" onSubmit={(event) => { event.preventDefault(); onCreateFolder(); }}><input autoFocus value={folderName} onChange={(event) => onFolderName(event.target.value)} placeholder={t("Folder name")} aria-label={t("Folder name")} maxLength={80} /><button className="primary-action" type="submit" disabled={!folderName.trim()}>{t("Create folder")}</button><button className="secondary-action" type="button" onClick={onCancelFolder}>{t("Cancel")}</button></form>}
    <div className="thread-folder-tabs" role="tablist" aria-label={t("Thread folders")}><button className={selectedFolder === "all" ? "thread-folder-tab-active" : ""} type="button" onClick={() => onFolderFilter("all")}>{t("All threads")}</button>{snapshot.folders.map((folder) => <button className={selectedFolder === folder.id ? "thread-folder-tab-active" : ""} type="button" key={folder.id} onClick={() => onFolderFilter(folder.id)}>{folder.name}</button>)}</div>
    <div className="thread-list">{visibleThreads.length === 0 ? <div className="empty-note">{t("No threads in this folder.")}</div> : visibleThreads.map((thread) => {
      const latest = thread.tasks.at(-1);
      return <div className={`thread-row ${thread.id === snapshot.currentThreadId ? "thread-row-selected" : ""}`} key={thread.id}>
        <button className="thread-row-main" type="button" onClick={() => onSelectThread(thread.id)}><strong>{thread.title}</strong><small>{latest ? `${statusLabel(locale, latest.status)} · ${latest.actions} ${t("actions")} · ${latest.steps} ${t("steps")}` : t("No tasks yet")}</small></button>
        <ThemedSelect className="thread-folder-select" value={thread.folderId ?? "none"} options={folderOptions} ariaLabel={`${t("Move thread")} ${thread.title}`} onChange={(value) => onMoveThread(thread.id, value)} />
      </div>;
    })}</div>
    <div className="thread-panel-footer"><span>{t("{count} threads", { count: snapshot.threads.length })}</span><button className="thread-panel-new-link" type="button" onClick={onNew}>{t("New thread")}</button></div>
  </section>;
}

function ThreadHistory({ thread, onContinue }: { thread: ThreadRecord; onContinue(): void }) {
  const { locale, t } = useTranslation();
  const tasks = [...thread.tasks].reverse();
  return <div className="thread-history"><div className="thread-history-heading"><div><div className="dialog-eyebrow">{t("Task history")}</div><strong>{thread.title}</strong></div>{thread.contextCompactedAt && <span className="thread-compacted-note">{t("Context compacted")}</span>}</div>{tasks.map((task) => <article className="thread-task-card" key={task.id}><div className="thread-task-card-top"><span>{t("Task")}</span><span className={`thread-task-status thread-task-status-${task.status}`}>{statusLabel(locale, task.status)}</span></div><p>{task.command}</p><div className="thread-task-meta"><span>{task.modelId}</span><span>{task.actions} {t("actions")}</span><span>{task.steps} {t("steps")}</span><span>{formatDuration(locale, task.durationMs)}</span></div></article>)}<button className="thread-continue-button" type="button" onClick={onContinue}>{t("Continue in this thread")} <Glyph name="arrow" /></button></div>;
}

function BrandLockup() { const { t } = useTranslation(); return <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><div><div className="brand-name">OpenUse</div><div className="brand-caption">{t("computer runtime")}</div></div></div>; }

function MacPermissionSetup({ selfTest }: { selfTest: EngineSelfTestResult }) {
  const { locale, t } = useTranslation();
  const permissionState = (value: EngineSelfTestResult["accessibilityPermission"]): string => t(value === "granted" ? "Granted" : value === "denied" ? "Not granted" : "Unknown");
  return <section className="privacy-setup" role="alert" aria-labelledby="privacy-setup-title"><div className="privacy-setup-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{t("Computer control setup")}</div><h2 id="privacy-setup-title">{t("OpenUse needs two macOS permissions.")}</h2></div><Glyph name="shield" /></div><p>{t("These permissions stay under macOS control. OpenUse will not start a Computer Use task until both are granted.")}</p><div className="privacy-setup-list"><div className="privacy-setup-row"><div><strong>{t("Accessibility")}</strong><span>{t("Control buttons, fields, and windows semantically.")}</span></div><div className={`privacy-state ${selfTest.accessibilityPermission === "granted" ? "privacy-state-granted" : ""}`}>{permissionState(selfTest.accessibilityPermission)}</div><button className="secondary-action" type="button" onClick={() => void runtimeApi.openMacPrivacy("accessibility")}>{t("Open Settings")}</button></div><div className="privacy-setup-row"><div><strong>{t("Screen Recording")}</strong><span>{t("Inspect the desktop when visual feedback is needed.")}</span></div><div className={`privacy-state ${selfTest.screenRecordingPermission === "granted" ? "privacy-state-granted" : ""}`}>{permissionState(selfTest.screenRecordingPermission)}</div><button className="secondary-action" type="button" onClick={() => void runtimeApi.openMacPrivacy("screen-recording")}>{t("Open Settings")}</button></div></div><div className="privacy-setup-actions"><span>{localizeRuntimeText(locale, selfTest.detail) ?? t("Grant both permissions in System Settings, then recheck.")}</span><button className="secondary-action" type="button" onClick={() => void runtimeApi.runSelfTest()}>{t("Recheck")}</button><button className="primary-action" type="button" onClick={() => void runtimeApi.relaunch()}>{t("Relaunch OpenUse")}</button></div></section>;
}

function EmptyActivity({ commands, onStarter }: { commands: string[]; onStarter(value: string): void }) { const { t } = useTranslation(); return <div className="empty-activity"><div className="empty-orbit" aria-hidden="true"><span className="orbit-core" /><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /></div><div className="empty-title">{t("Your computer, on request.")}</div><p>{t("Start with a small task. OpenUse will observe, act, and verify each step.")}</p><div className="starter-list">{commands.map((starter) => <button type="button" key={starter} onClick={() => onStarter(starter)}>{starter}<Glyph name="arrow" /></button>)}</div></div>; }
function UserEntry({ command }: { command: string }) { const { t } = useTranslation(); return <div className="timeline-entry user-entry"><div className="entry-avatar user-avatar">{t("You")}</div><div className="entry-body"><div className="entry-label">{t("User")}</div><div className="user-command">{command}</div></div></div>; }
function ActionEntry({ action }: { action: TimelineAction }) { const { locale } = useTranslation(); const failed = action.status === "failed"; return <div className={`timeline-entry action-entry action-${action.status}`}><div className={`entry-status ${failed ? "entry-status-failed" : action.status === "completed" ? "entry-status-done" : "entry-status-active"}`}>{failed ? <Glyph name="alert" /> : action.status === "completed" ? <Glyph name="check" /> : <span className="mini-spinner" />}</div><div className="entry-body"><div className="action-line"><span>{localizeRuntimeText(locale, action.summary)}</span>{action.durationMs !== undefined && <time>{formatDuration(locale, action.durationMs)}</time>}</div>{action.detail && <div className="entry-detail">{localizeRuntimeText(locale, action.detail)}</div>}{failed && <div className="entry-error">{localizeRuntimeText(locale, action.errorMessage)}</div>}</div></div>; }

function PermissionDialog({ request, onDecision, onStop }: { request: PermissionRequest; onDecision(decision: PermissionDecision): void; onStop(): void }) { const { locale, t } = useTranslation(); const denyRef = useRef<HTMLButtonElement>(null); const persistentApprovalAllowed = request.risk === "read" || request.risk === "interaction"; useEffect(() => { denyRef.current?.focus(); const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onStop(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [onStop]); return <div className="modal-backdrop permission-backdrop" role="presentation"><div className="permission-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permission-title" aria-describedby="permission-description"><div className="permission-icon"><Glyph name="shield" /></div><div className="dialog-eyebrow">{t("Permission required")}</div><h2 id="permission-title">{t("Allow OpenUse to control {app}?", { app: request.appName })}</h2><p id="permission-description">{t("OpenUse wants to")} <strong>{localizeRuntimeText(locale, request.actionSummary)}</strong>. {t("The runtime classified this as")} <span className="risk-label">{t(request.risk)}</span>.</p><div className="permission-reason"><span>{t("Why you're seeing this")}</span><p>{localizeRuntimeText(locale, request.reason)}</p></div><div className="dialog-actions"><button ref={denyRef} className="secondary-action" type="button" onClick={() => onDecision("deny")}>{t("Deny")}</button><button className="secondary-action" type="button" onClick={() => onDecision("allow-once")}>{t("Allow once")}</button>{persistentApprovalAllowed && <button className="primary-action" type="button" onClick={() => onDecision("always-allow")}>{t("Always allow")}</button>}<button className="stop-dialog-action" type="button" onClick={onStop}>{t("Stop task")}</button></div></div></div>; }

function SettingsDialog({ settings, models, catalogStatus, usage, apiKeyDraft, customKeyDraft, onApiKeyChange, onCustomKeyChange, onClose, onSaveGateway, onSaveCustom, onTestConnection, connectionTest, onProvider, onLocale, onReasoning, onAppearance, onRefreshModels, onResetUsage, onPermissionChange, onRunSelfTest, onOpenMacPrivacy }: {
  settings: AppSettings;
  models: ModelDefinition[];
  catalogStatus: ModelCatalogStatus;
  usage: UsageSummary;
  apiKeyDraft: string;
  customKeyDraft: string;
  onApiKeyChange(value: string): void;
  onCustomKeyChange(value: string): void;
  onClose(): void;
  onSaveGateway(modelId: string): void;
  onSaveCustom(input: { baseUrl: string; modelId: string; capabilities: { toolCalling: boolean; vision: boolean; reasoning: boolean }}): void;
  onTestConnection(modelId: string): void;
  connectionTest: ConnectionTestState;
  onProvider(provider: "vercel-gateway" | "custom-openai-compatible"): void;
  onLocale(locale: Locale): void;
  onReasoning(value: ReasoningEffort): void;
  onAppearance(patch: { primaryColor?: string; backgroundBlur?: number; backgroundOpacity?: number; showAgentCursor?: boolean }): void;
  onRefreshModels(): void;
  onResetUsage(): void;
  onPermissionChange(appName: string, level: PermissionLevel, appIdentity?: string): void;
  onRunSelfTest(): void;
  onOpenMacPrivacy(area: "accessibility" | "screen-recording"): void;
}) {
  const [section, setSection] = useState<SettingsSection>("ai");
  const [modelId, setModelId] = useState(settings.modelId);
  const [customBaseUrl, setCustomBaseUrl] = useState(settings.customProvider.baseUrl);
  const [customModelId, setCustomModelId] = useState(settings.customProvider.modelId);
  const [customCapabilities, setCustomCapabilities] = useState(settings.customProvider.capabilities);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => { dialogRef.current?.focus(); const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [onClose]);
  const { t } = useTranslation();
  const sections: Array<[SettingsSection, string, string]> = [["ai", t("AI"), t("Models and providers")], ["appearance", t("Appearance"), t("Color and material")], ["usage", t("Usage"), t("Spend recorded locally")], ["permissions", t("Permissions"), t("Apps OpenUse may control")], ["advanced", t("Advanced"), t("Runtime diagnostics")]];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialogRef}><div className="dialog-topline"><div><div className="dialog-eyebrow">{t("OpenUse configuration")}</div><h2 id="settings-title">{t("Settings")}</h2></div><button className="close-button" type="button" aria-label={t("Close Settings")} onClick={onClose}>×</button></div><div className="settings-layout"><nav className="settings-nav" aria-label={t("Settings sections")}>{sections.map(([id, label, description]) => <button type="button" key={id} className={section === id ? "settings-nav-active" : ""} onClick={() => setSection(id)}><span>{label}</span><small>{description}</small></button>)}</nav><div className="settings-content">{section === "ai" && <><AISettings settings={settings} models={models} catalogStatus={catalogStatus} modelId={modelId} setModelId={setModelId} apiKeyDraft={apiKeyDraft} onApiKeyChange={onApiKeyChange} customKeyDraft={customKeyDraft} onCustomKeyChange={onCustomKeyChange} customBaseUrl={customBaseUrl} setCustomBaseUrl={setCustomBaseUrl} customModelId={customModelId} setCustomModelId={setCustomModelId} customCapabilities={customCapabilities} setCustomCapabilities={setCustomCapabilities} onProvider={onProvider} onSaveGateway={onSaveGateway} onSaveCustom={onSaveCustom} onTestConnection={onTestConnection} connectionTest={connectionTest} onRefreshModels={onRefreshModels} /><div className="settings-divider" /><ReasoningSettings model={settings.provider === "vercel-gateway" ? models.find((model) => model.id === settings.modelId) : { id: settings.customProvider.modelId, label: settings.customProvider.modelId, provider: "custom-openai-compatible", capabilities: settings.customProvider.capabilities }} value={settings.reasoningEffort} onReasoning={onReasoning} /></>}{section === "appearance" && <AppearanceSettings settings={settings} onAppearance={onAppearance} onLocale={onLocale} />}{section === "usage" && <UsageSettings usage={usage} onReset={onResetUsage} />}{section === "permissions" && <PermissionsSettings settings={settings} onPermissionChange={onPermissionChange} />}{section === "advanced" && <AdvancedSettings settings={settings} catalogStatus={catalogStatus} onRunSelfTest={onRunSelfTest} onOpenMacPrivacy={onOpenMacPrivacy} />}</div></div><div className="dialog-footer"><span className="settings-status"><span className={`status-dot ${settings.provider === "vercel-gateway" ? (settings.apiKeyConfigured ? "status-ready" : "status-offline") : "status-ready"}`} />{settings.provider === "vercel-gateway" ? (settings.apiKeyConfigured ? t("Gateway key configured") : t("Gateway key needed")) : t("Custom endpoint selected")}</span><button className="secondary-action" type="button" onClick={onClose}>{t("Done")}</button></div></div></div>;
}

interface AISettingsProps {
  settings: AppSettings;
  models: ModelDefinition[];
  catalogStatus: ModelCatalogStatus;
  modelId: string;
  setModelId: Dispatch<SetStateAction<string>>;
  apiKeyDraft: string;
  onApiKeyChange(value: string): void;
  customKeyDraft: string;
  onCustomKeyChange(value: string): void;
  customBaseUrl: string;
  setCustomBaseUrl: Dispatch<SetStateAction<string>>;
  customModelId: string;
  setCustomModelId: Dispatch<SetStateAction<string>>;
  customCapabilities: AppSettings["customProvider"]["capabilities"];
  setCustomCapabilities: Dispatch<SetStateAction<AppSettings["customProvider"]["capabilities"]>>;
  onProvider(provider: AppSettings["provider"]): void;
  onSaveGateway(modelId: string): void;
  onSaveCustom(input: { baseUrl: string; modelId: string; capabilities: AppSettings["customProvider"]["capabilities"] }): void;
  onTestConnection(modelId: string): void;
  connectionTest: ConnectionTestState;
  onRefreshModels(): void;
}

function AISettings({ settings, models, catalogStatus, modelId, setModelId, apiKeyDraft, onApiKeyChange, customKeyDraft, onCustomKeyChange, customBaseUrl, setCustomBaseUrl, customModelId, setCustomModelId, customCapabilities, setCustomCapabilities, onProvider, onSaveGateway, onSaveCustom, onTestConnection, connectionTest, onRefreshModels }: AISettingsProps) {
  const { locale, t } = useTranslation();
  const catalogSource = catalogStatus.source === "gateway-live" ? t("live") : catalogStatus.source === "gateway-cache" ? t("cached") : t("fallback");
  return <div className="settings-section"><div className="settings-section-heading"><div><div className="dialog-eyebrow">{t("AI")}</div><h3>{t("Choose how OpenUse thinks.")}</h3></div><span className="catalog-status">{t("{count} models / {source}", { count: formatNumber(locale, catalogStatus.count), source: catalogSource })}</span></div><div className="provider-tabs"><button type="button" className={settings.provider === "vercel-gateway" ? "provider-tab-active" : ""} onClick={() => onProvider("vercel-gateway")}>{t("Vercel AI Gateway")}</button><button type="button" className={settings.provider === "custom-openai-compatible" ? "provider-tab-active" : ""} onClick={() => onProvider("custom-openai-compatible")}>{t("Custom endpoint")}</button></div>{settings.provider === "vercel-gateway" ? <><div className="settings-field"><div className="field-label-row"><label>{t("Computer Use model")}</label><button className="link-button" type="button" onClick={onRefreshModels} disabled={catalogStatus.isRefreshing}>{catalogStatus.isRefreshing ? t("Refreshing...") : t("Refresh catalog")}</button></div><ModelPicker models={models} value={modelId} onSelect={setModelId} /><div className="field-note">{t("Showing models that advertise both tool calling and visual input. The catalog is validated and cached locally.")}</div></div><div className="settings-field"><label htmlFor="gateway-key">{t("API key")}</label><input id="gateway-key" type="password" autoComplete="off" value={apiKeyDraft} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={settings.apiKeyConfigured ? t("Key saved - enter a new key to replace it") : t("Paste your AI_GATEWAY_API_KEY")} /><div className="field-note"><Glyph name="lock" /> {t("Stored locally with OS-backed encryption. Never returned to the renderer.")}</div></div><div className="connection-test"><button className="secondary-action" type="button" disabled={connectionTest === "testing"} onClick={() => onTestConnection(modelId)}>{connectionTest === "testing" ? t("Testing...") : t("Test connection")}</button>{connectionTest !== "idle" && connectionTest !== "testing" && <span className={connectionTest.ok ? "connection-success" : "connection-failure"}>{localizeRuntimeText(locale, connectionTest.message)}</span>}</div><button className="primary-action settings-save" type="button" onClick={() => onSaveGateway(modelId)}>{t("Save Gateway settings")}</button></> : <CustomProviderSettings baseUrl={customBaseUrl} setBaseUrl={setCustomBaseUrl} modelId={customModelId} setModelId={setCustomModelId} capabilities={customCapabilities} setCapabilities={setCustomCapabilities} keyDraft={customKeyDraft} onKeyChange={onCustomKeyChange} configured={settings.customProvider.apiKeyConfigured} onSave={() => onSaveCustom({ baseUrl: customBaseUrl, modelId: customModelId, capabilities: customCapabilities })} />}</div>;
}

interface CustomProviderSettingsProps {
  baseUrl: string;
  setBaseUrl: Dispatch<SetStateAction<string>>;
  modelId: string;
  setModelId: Dispatch<SetStateAction<string>>;
  capabilities: AppSettings["customProvider"]["capabilities"];
  setCapabilities: Dispatch<SetStateAction<AppSettings["customProvider"]["capabilities"]>>;
  keyDraft: string;
  onKeyChange(value: string): void;
  configured: boolean;
  onSave(): void;
}

function CustomProviderSettings({ baseUrl, setBaseUrl, modelId, setModelId, capabilities, setCapabilities, keyDraft, onKeyChange, configured, onSave }: CustomProviderSettingsProps) { const { t } = useTranslation(); const setPreset = (url: string, model: string) => { setBaseUrl(url); setModelId(model); }; return <div className="custom-provider-block"><div className="settings-field"><label>{t("Endpoint preset")}</label><div className="preset-row"><button className="secondary-action" type="button" onClick={() => setPreset("http://localhost:11434/v1", "llama3.2-vision")}>Ollama</button><button className="secondary-action" type="button" onClick={() => setPreset("http://localhost:1234/v1", "local-model")}>LM Studio</button></div></div><div className="settings-field"><label htmlFor="custom-base-url">{t("Base URL")}</label><input id="custom-base-url" className="technical" dir="ltr" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" /></div><div className="settings-field"><label htmlFor="custom-model-id">{t("Model ID")}</label><input id="custom-model-id" className="technical" dir="ltr" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="llama3.2-vision" /><div className="field-note">{t("OpenAI-compatible chat completions endpoint. OpenUse does not infer local model capabilities.")}</div></div><div className="settings-field"><label htmlFor="custom-key">{t("API key")} <span className="optional-label">{t("optional")}</span></label><input id="custom-key" type="password" autoComplete="off" dir="ltr" value={keyDraft} onChange={(event) => onKeyChange(event.target.value)} placeholder={configured ? t("Key saved - enter a new key to replace it") : t("Leave blank for local servers")} /></div><div className="capability-config"><div className="capability-config-title">{t("Declare endpoint capabilities")}</div>{([ ["toolCalling", "Tool calling", "Required for Computer Use"], ["vision", "Visual input", "Required for Computer Use"], ["reasoning", "Configurable reasoning", "Allows reasoning controls"] ] as const).map(([key, label, note]) => <label key={key} className="check-row"><input type="checkbox" checked={capabilities[key]} onChange={(event) => setCapabilities({ ...capabilities, [key]: event.target.checked })} /><span><strong>{t(label)}</strong><small>{t(note)}</small></span></label>)}</div><div className="custom-warning"><Glyph name="alert" />{t("Custom endpoints do not provide trusted pricing metadata. Cost is shown as unknown.")}</div><button className="primary-action settings-save" type="button" onClick={onSave}>{t("Use custom endpoint")}</button></div>; }

function ReasoningSettings({ model, value, onReasoning }: { model?: ModelDefinition; value: ReasoningEffort; onReasoning(value: ReasoningEffort): void }) { const { t } = useTranslation(); return <div className="settings-field"><label>{t("Reasoning level")}</label><ReasoningSelect model={model} value={value} onChange={onReasoning} /><div className="field-note">{t("Only levels advertised by the selected model are sent. Unsupported choices fall back to Provider default.")}</div></div>; }

function AppearanceSettings({ settings, onAppearance, onLocale }: { settings: AppSettings; onAppearance(patch: { primaryColor?: string; backgroundBlur?: number; backgroundOpacity?: number; showAgentCursor?: boolean }): void; onLocale(locale: Locale): void }) { const { t } = useTranslation(); const presets = ["#c8f36a", "#8bd5ff", "#ffb86b", "#d9a7ff", "#f3f3f3"]; return <div className="settings-section"><div className="dialog-eyebrow">{t("Appearance")}</div><h3>{t("One signal color. A window that recedes.")}</h3><p className="settings-lede">{t("OpenUse uses black, white, and one selected primary. The native material lets the desktop remain present while controls stay crisp.")}</p><div className="settings-field"><label htmlFor="locale-select">{t("Language")}</label><ThemedSelect id="locale-select" className="language-select" value={settings.locale} options={[{ value: "en", label: t("English") }, { value: "fa", label: t("Persian") }]} ariaLabel={t("Language")} onChange={(value) => onLocale(value as Locale)} /><div className="field-note">{t("Language changes apply immediately to the whole interface.")}</div></div><div className="settings-field"><label>{t("Primary color")}</label><div className="color-presets">{presets.map((color) => <button key={color} className={`color-swatch ${settings.primaryColor === color ? "color-swatch-selected" : ""}`} style={{ backgroundColor: color }} type="button" aria-label={t("Use {color}", { color })} onClick={() => onAppearance({ primaryColor: color })}><span /></button>)}<input className="color-picker" type="color" value={settings.primaryColor} onChange={(event) => onAppearance({ primaryColor: event.target.value })} aria-label={t("Custom primary color")} /></div><div className="hex-input" dir="ltr"><span>#</span><input aria-label={`${t("Primary color")} HEX`} value={settings.primaryColor.replace(/^#/, "")} maxLength={6} onChange={(event) => { const value = event.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 6); if (value.length === 6) onAppearance({ primaryColor: `#${value}` }); }} /><span className="color-preview" style={{ backgroundColor: settings.primaryColor }} /></div></div><RangeField id="background-blur" label={t("Background blur")} value={settings.backgroundBlur} min={0} max={40} step={1} suffix="px" onChange={(value) => onAppearance({ backgroundBlur: value })} /><RangeField id="background-opacity" label={t("Background opacity")} value={Math.round(settings.backgroundOpacity * 100)} min={45} max={100} step={1} suffix="%" onChange={(value) => onAppearance({ backgroundOpacity: value / 100 })} /><label className="toggle-row"><span><strong>{t("Show OpenUse cursor")}</strong><small>{t("Show the virtual target overlay while the agent acts.")}</small></span><input type="checkbox" checked={settings.showAgentCursor} onChange={(event) => onAppearance({ showAgentCursor: event.target.checked })} /><span className="toggle-control" /></label></div>; }

function RangeField({ id, label, value, min, max, step, suffix, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; suffix: string; onChange(value: number): void }) { const { locale } = useTranslation(); const localizedSuffix = locale === "fa" ? (suffix === "px" ? " پیکسل" : "٪") : suffix; return <div className="settings-field range-field"><div className="field-label-row"><label htmlFor={id}>{label}</label><output htmlFor={id}>{formatNumber(locale, value)}{localizedSuffix}</output></div><input id={id} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></div>; }

function UsageSettings({ usage, onReset }: { usage: UsageSummary; onReset(): void }) { const { locale, t } = useTranslation(); return <div className="settings-section"><div className="dialog-eyebrow">{t("Usage")}</div><h3>{t("Spend recorded through this installation.")}</h3><div className="usage-grid"><Metric label={t("Known spend")} value={formatMoney(locale, usage.totalKnownSpend)} /><Metric label={t("Completed tasks")} value={formatNumber(locale, usage.completedTasks)} /><Metric label={t("Input tokens")} value={formatNumber(locale, usage.inputTokens)} /><Metric label={t("Output tokens")} value={formatNumber(locale, usage.outputTokens)} /><Metric label={t("Average task")} value={usage.averageTaskCost === undefined ? "-" : formatMoney(locale, usage.averageTaskCost)} /><Metric label={t("Unpriced requests")} value={formatNumber(locale, usage.unpricedRequests)} /></div><p className="field-note">{t("The usage ledger stores model IDs, token counts, action counts, timing, status, reasoning level, and known cost. Thread history stores task commands so you can continue work. Screenshots, accessibility content, credentials, and chain-of-thought are not written.")}</p><div className="settings-divider" /><div className="settings-section-heading"><div><div className="dialog-eyebrow">{t("Recent model usage")}</div><h4>{t("Where requests are going")}</h4></div></div><div className="model-usage-list">{usage.modelUsage.length === 0 ? <div className="empty-note">{t("Usage appears after the first model request.")}</div> : usage.modelUsage.slice(0, 12).map((model) => <div className="model-usage-row" key={`${model.provider}:${model.modelId}`}><div><strong className="technical">{model.modelId}</strong><span className="technical">{model.provider} / {formatNumber(locale, model.requestCount)} {t("requests")}</span></div><strong>{formatMoney(locale, model.knownSpend)}</strong></div>)}</div><button className="danger-outline" type="button" onClick={() => { if (window.confirm(t("Reset local usage history? This cannot be undone."))) onReset(); }}>{t("Reset local usage history")}</button></div>; }

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }

function PermissionsSettings({ settings, onPermissionChange }: { settings: AppSettings; onPermissionChange(appName: string, level: PermissionLevel, appIdentity?: string): void }) { const { t } = useTranslation(); return <div className="settings-section"><div className="dialog-eyebrow">{t("Permissions")}</div><h3>{t("Who can OpenUse control?")}</h3><p className="settings-lede">{t("App permissions apply to semantic actions, coordinate fallback, screenshots, and keyboard input. Safety risk still determines whether a confirmation is required.")}</p><div className="permission-list">{settings.permissions.map((record) => <div className="permission-row" key={record.appIdentity ?? record.appName}><div><div className="permission-app">{record.appName}</div><div className="permission-updated">{record.level === "ALLOW" ? t("Control allowed") : record.level === "DENY" ? t("Control blocked") : t("Ask each time")}</div></div><ThemedSelect className="permission-select" value={record.level} options={[{ value: "ALLOW", label: "ALLOW" }, { value: "ASK", label: "ASK" }, { value: "DENY", label: "DENY" }]} ariaLabel={`${record.appName} ${t("permission")}`} onChange={(value) => onPermissionChange(record.appName, value as PermissionLevel, record.appIdentity)} /></div>)}</div></div>; }

function AdvancedSettings({ settings, catalogStatus, onRunSelfTest, onOpenMacPrivacy }: { settings: AppSettings; catalogStatus: ModelCatalogStatus; onRunSelfTest(): void; onOpenMacPrivacy(area: "accessibility" | "screen-recording"): void }) {
  const { locale, t } = useTranslation();
  const catalogSource = catalogStatus.source === "gateway-live" ? t("live") : catalogStatus.source === "gateway-cache" ? t("cached") : t("fallback");
  return <div className="settings-section">
    <div className="dialog-eyebrow">{t("Advanced")}</div>
    <h3>{t("Runtime details.")}</h3>
    <div className="advanced-list">
      <div><span>{t("Provider")}</span><strong>{providerLabel(locale, settings.provider)}</strong></div>
      <div><span>{t("Catalog")}</span><strong>{catalogSource} / {formatNumber(locale, catalogStatus.count)} {t("models")}</strong></div>
      <div><span>{t("Cursor")}</span><strong>{settings.showAgentCursor ? t("Visible during tasks") : t("Hidden")}</strong></div>
      <div><span>{t("Storage")}</span><strong>{t("Local, atomic, privacy-safe")}</strong></div>
    </div>
    <div className="settings-divider" />
    <div className="advanced-actions">
      <button className="secondary-action" type="button" onClick={onRunSelfTest}>{t("Run native self-test")}</button>
      {settings.provider === "vercel-gateway" && <span>{t("Runtime information stays in the local process.")}</span>}
      {settings.customProvider.baseUrl && <span>{t("Custom endpoint: {url}", { url: settings.customProvider.baseUrl })}</span>}
    </div>
    <div className="settings-divider" />
    <div className="advanced-actions">
      <strong>{t("Safety boundaries")}</strong>
      <span>{t("OpenUse does not expose arbitrary shells, unrestricted filesystems, credential capture, hidden remote access, or software installation to the model.")}</span>
    </div>
    {navigator.platform.toLowerCase().includes("mac") && <div className="advanced-actions">
      <button className="secondary-action" type="button" onClick={() => onOpenMacPrivacy("accessibility")}>{t("Open Accessibility settings")}</button>
      <button className="secondary-action" type="button" onClick={() => onOpenMacPrivacy("screen-recording")}>{t("Open Screen Recording settings")}</button>
    </div>}
  </div>;
}

function ModelPicker({ models, value, onSelect, compact = false, disabled = false }: { models: ModelDefinition[]; value: string; onSelect(modelId: string): void; compact?: boolean; disabled?: boolean }) { const { locale, t } = useTranslation(); const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [showAll, setShowAll] = useState(false); const [provider, setProvider] = useState("all"); const compatibleModels = models.filter((model) => getCompatibilityIssues(model).length === 0); const source = showAll ? models : compatibleModels; const providers = [...new Set(source.map((model) => model.sourceProvider || "other"))].sort(); const filtered = source.filter((model) => (provider === "all" || (model.sourceProvider || "other") === provider) && `${model.label} ${model.id} ${model.description ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 120); const selected = models.find((model) => model.id === value); return <div className={`model-picker-control ${compact ? "model-picker-compact" : ""}`}><button className="model-picker-trigger" type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? value}</span><small className="technical">{selected?.id ?? value}</small><Glyph name="chevron" /></button>{open && <div className="model-picker-popover"><div className="model-picker-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search models or IDs")} aria-label={t("Search models")} /><button type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? t("Computer Use only") : t("Show all models")}</button></div><div className="model-picker-filters"><button className={provider === "all" ? "filter-active" : ""} type="button" onClick={() => setProvider("all")}>{t("All providers")}</button>{providers.map((item) => <button className={provider === item ? "filter-active" : ""} type="button" key={item} onClick={() => setProvider(item)}>{item}</button>)}</div><div className="model-picker-list" role="listbox">{filtered.length === 0 ? <div className="empty-note">{t("No models match this search.")}</div> : filtered.map((model) => { const issues = getCompatibilityIssues(model); return <button className={`model-option ${model.id === value ? "model-option-selected" : ""}`} role="option" aria-selected={model.id === value} type="button" key={model.id} onClick={() => { onSelect(model.id); setOpen(false); }}><span className="model-option-top"><strong>{model.label}</strong><small>{model.sourceProvider || "Gateway"}</small></span><span className="model-option-id technical">{model.id}</span><span className="model-option-meta"><span className={model.capabilities.vision ? "" : "meta-missing"}>{model.capabilities.vision ? t("Vision") : t("No vision")}</span><span className={model.capabilities.toolCalling ? "" : "meta-missing"}>{model.capabilities.toolCalling ? t("Tools") : t("No tools")}</span><span>{model.capabilities.reasoning ? t("Reasoning") : t("Provider default")}</span><span>{t("Input {price}", { price: formatModelPrice(model.pricing?.inputPerToken, model.pricing?.inputTiers, locale) })}</span><span>{t("Output {price}", { price: formatModelPrice(model.pricing?.outputPerToken, model.pricing?.outputTiers, locale) })}</span></span>{showAll && issues.length > 0 && <span className="model-option-warning">{t("Unavailable for Computer Use: {reason}", { reason: issues.map((issue) => localizeRuntimeText(locale, issue)).join(" ") })}</span>}</button>; })}</div><div className="model-picker-foot">{filtered.length >= 120 ? t("Showing the first {count} matches.", { count: formatNumber(locale, 120) }) : t("{count} models", { count: formatNumber(locale, filtered.length) })} / {t("catalog {age}", { age: catalogAgeLabel(models, locale) })}</div></div>}</div>; }

interface ThemedSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ThemedSelectProps {
  id?: string;
  value: string;
  options: ThemedSelectOption[];
  ariaLabel: string;
  onChange(value: string): void;
  className?: string;
  disabled?: boolean;
}

function ThemedSelect({ id, value, options, ariaLabel, onChange, className = "", disabled = false }: ThemedSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectId = useId();
  const menuId = `themed-select-${selectId.replace(/:/g, "")}`;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value && !option.disabled));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options.find((option) => option.value === value) ?? options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    menuRef.current?.focus();
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnWindowBlur = () => setOpen(false);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("blur", closeOnWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("blur", closeOnWindowBlur);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const openMenu = () => {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let offset = 0; offset < options.length; offset += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  const moveToEdge = (edge: "start" | "end") => {
    const indexes = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
    if (indexes.length > 0) setActiveIndex(edge === "start" ? indexes[0] : indexes[indexes.length - 1]);
  };

  const chooseActive = () => {
    const option = options[activeIndex];
    if (option && !option.disabled) {
      onChange(option.value);
      closeMenu();
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) {
        if (event.key === "ArrowDown") moveActive(1);
        else if (event.key === "ArrowUp") moveActive(-1);
        else chooseActive();
      } else {
        openMenu();
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
    }
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveToEdge("start");
    } else if (event.key === "End") {
      event.preventDefault();
      moveToEdge("end");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseActive();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeMenu();
    }
  };

  return <div ref={rootRef} className={`select-wrap themed-select ${className}`.trim()}>
    <button ref={triggerRef} id={id} className="themed-select-trigger" type="button" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} disabled={disabled} onClick={() => open ? closeMenu() : openMenu()} onKeyDown={onTriggerKeyDown}>
      <span>{selected?.label ?? value}</span>
      <Glyph name="chevron" />
    </button>
    {open && <div ref={menuRef} id={menuId} className="themed-select-menu" role="listbox" tabIndex={-1} aria-label={ariaLabel} aria-activedescendant={`${menuId}-option-${activeIndex}`} onKeyDown={onMenuKeyDown}>
      {options.map((option, index) => <button id={`${menuId}-option-${index}`} className={`themed-select-option ${index === activeIndex ? "themed-select-option-active" : ""} ${option.value === value ? "themed-select-option-selected" : ""}`} type="button" role="option" tabIndex={-1} aria-selected={option.value === value} disabled={option.disabled} key={option.value} onMouseEnter={() => setActiveIndex(index)} onClick={() => { onChange(option.value); closeMenu(); }}>
        <span>{option.label}</span>
        {option.value === value && <span className="themed-select-check" aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}

function ReasoningSelect({ model, value, onChange, compact = false, disabled = false }: { model?: ModelDefinition; value: ReasoningEffort; onChange(value: ReasoningEffort): void; compact?: boolean; disabled?: boolean }) { const { locale, t } = useTranslation(); const supported: ReasoningEffort[] = model?.capabilities.reasoning ? model.capabilities.reasoningEfforts ?? ["provider-default"] : ["provider-default"]; return <ThemedSelect className={`reasoning-select ${compact ? "reasoning-select-compact" : ""}`} ariaLabel={t("Reasoning level")} value={supported.includes(value) ? value : "provider-default"} disabled={disabled || supported.length <= 1} options={supported.map((effort) => ({ value: effort, label: reasoningLabel(locale, effort) }))} onChange={(nextValue) => onChange(nextValue as ReasoningEffort)} />; }

function SpendPill({ taskCost, total }: { taskCost: number; total: number }) { const { locale, t } = useTranslation(); return <div className="spend-pill" title={t("Known cost reported by the provider during this task and through this OpenUse installation")}><span>{t("Spend")}</span><strong>{formatMoney(locale, taskCost)}</strong><small>/ {formatMoney(locale, total)} {t("total")}</small></div>; }
function Estimate({ model, usage }: { model: ModelDefinition; usage: UsageSummary }) { const { locale, t } = useTranslation(); const profile = profileFromUsage(model, usage); const estimate = estimateTwentyStepCost(model, profile); return <span className="estimate" title={t("Approximate 20-step estimate based on recent local token usage and current catalog pricing. It is not a guarantee.")}>≈ {estimate === undefined ? t("unavailable") : formatMoney(locale, estimate)}</span>; }
function profileFromUsage(model: ModelDefinition, usage: UsageSummary) { const own = usage.modelUsage.find((item) => item.modelId === model.id); const source = own ?? (usage.modelUsage.length > 0 ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, requestCount: usage.modelUsage.reduce((sum, item) => sum + item.requestCount, 0) } : undefined); return source && source.requestCount > 0 ? { inputTokensPerStep: source.inputTokens / source.requestCount, outputTokensPerStep: source.outputTokens / source.requestCount, source: own ? "model" as const : "general" as const } : undefined; }
function catalogAgeLabel(models: ModelDefinition[], locale: Locale): string { const model = models.find((item) => item.createdAt || item.releasedAt); return model?.releasedAt ? translate(locale, "dated") : translate(locale, "local"); }
function formatModelPrice(direct: number | undefined, tiers: Array<{ perToken: number }> | undefined, locale: Locale): string { const price = direct ?? tiers?.[0]?.perToken; const prefix = tiers && direct === undefined ? translate(locale, "from") + " " : ""; return `${prefix}${formatPricePerMillion(locale, price)}`; }

function primaryForeground(hex: string): string { const value = hex.replace("#", ""); if (value.length !== 6) return "#0a0a0a"; const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]; return luminance > 0.52 ? "#0a0a0a" : "#ffffff"; }
type ConnectionTestState = "idle" | "testing" | GatewayConnectionResult;

function Glyph({ name }: { name: GlyphName }) { const paths: Record<GlyphName, string> = { activity: "M3 12h4l2-7 4 14 2-7h6", sliders: "M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4", chevron: "m7 10 5 5 5-5", arrow: "M4 12h15m-6-6 6 6-6 6", plus: "M12 5v14M5 12h14", spark: "m12 3 1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-2.5L12 3Z", tool: "M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.4-2.4 1.8-2.9Z", desktop: "M4 5h16v11H4zM9 20h6M12 16v4", shield: "M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z", check: "m5 12 4 4L19 6", alert: "M12 4 21 20H3L12 4Zm0 6v4m0 3h.01", lock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3", chart: "M4 19V5m0 14h16M8 16v-5m4 5V7m4 9v-8", minus: "M5 12h14", square: "M5 5h14v14H5z", restore: "M7 7h10v10H7zM7 10H5v9h9v-2", close: "M6 6l12 12M18 6 6 18" }; return <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>; }
type GlyphName = "activity" | "sliders" | "chevron" | "arrow" | "plus" | "spark" | "tool" | "desktop" | "shield" | "check" | "alert" | "lock" | "chart" | "minus" | "square" | "restore" | "close";
