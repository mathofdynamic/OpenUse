import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { MODEL_CATALOG, estimateTwentyStepCost, formatPricePerMillion, getCompatibilityIssues, type GatewayConnectionResult } from "@openuse/ai";
import { defaultPermissionRecords } from "@openuse/permissions";
import type {
  AgentStatus,
  AppSettings,
  AppSnapshot,
  EngineSelfTestResult,
  EngineStatus,
  ModelCatalogStatus,
  ModelDefinition,
  PermissionDecision,
  PermissionLevel,
  PermissionRequest,
  QualificationDebugSnapshot,
  QualificationSessionInfo,
  ReasoningEffort,
  RuntimeEvent,
  TimelineAction,
  UsageSummary,
} from "@openuse/shared";

type TimelineEntry =
  | { kind: "user"; id: string; command: string }
  | { kind: "action"; action: TimelineAction };

type SettingsSection = "ai" | "appearance" | "usage" | "permissions" | "advanced";

const WINDOWS_STARTER_COMMANDS = [
  "Open Notepad and type \"Hello from OpenUse\"",
  "Open Calculator and calculate 37 x 19",
  "Open Notepad, type \"OpenUse test file\", and save it as openuse-test.txt on my Desktop.",
];

const MACOS_STARTER_COMMANDS = [
  "Open TextEdit and type \"Hello from OpenUse\"",
  "Open Calculator and calculate 37 x 19",
  "Open TextEdit, type \"OpenUse test file\", and save it as openuse-test.txt on my Desktop.",
];

const emptyEngine: EngineStatus = { platform: "unknown", state: "offline", detail: "Connecting to the local runtime..." };
const emptySettings: AppSettings = {
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

const emptySnapshot: AppSnapshot = {
  settings: { ...emptySettings, permissions: defaultPermissionRecords() },
  engine: { ...emptyEngine, platform: "browser-preview", state: "unsupported", detail: "The desktop bridge is available inside Electron only." },
  qualification: emptyQualification,
  modelCatalog: { models: MODEL_CATALOG, status: emptyCatalogStatus },
  usage: emptyUsage,
};

const browserPreviewBridge: Window["openuse"] = {
  getSnapshot: async () => emptySnapshot,
  setModel: async () => emptySnapshot,
  setProvider: async () => emptySnapshot,
  setReasoningEffort: async () => emptySnapshot,
  setAppearance: async () => emptySnapshot,
  setCustomProvider: async () => emptySnapshot,
  saveGatewayApiKey: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  saveCustomApiKey: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  testGatewayConnection: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  runSelfTest: async () => { throw new Error("Diagnostics are available in the OpenUse desktop app."); },
  openMacPrivacy: async () => { throw new Error("macOS privacy settings are available in the OpenUse desktop app."); },
  relaunch: async () => { throw new Error("Relaunch is available in the OpenUse desktop app."); },
  startTask: async () => { throw new Error("Computer control is available in the OpenUse desktop app."); },
  stopTask: async () => undefined,
  refreshModelCatalog: async () => emptySnapshot,
  resetUsage: async () => emptySnapshot,
  decidePermission: async () => undefined,
  setAppPermission: async () => undefined,
  onEvent: () => () => undefined,
  onSnapshot: () => () => undefined,
};

const runtimeApi = window.openuse ?? browserPreviewBridge;

export function App() {
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [engine, setEngine] = useState<EngineStatus>(emptyEngine);
  const [qualification, setQualification] = useState<QualificationSessionInfo>(emptyQualification);
  const [models, setModels] = useState<ModelDefinition[]>(MODEL_CATALOG);
  const [catalogStatus, setCatalogStatus] = useState<ModelCatalogStatus>(emptyCatalogStatus);
  const [usage, setUsage] = useState<UsageSummary>(emptyUsage);
  const [debugSnapshot, setDebugSnapshot] = useState<QualificationDebugSnapshot | undefined>();
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
  const composerRef = useRef<HTMLTextAreaElement>(null);

  function applySnapshot(snapshot: AppSnapshot) {
    setSettings(snapshot.settings);
    setEngine(snapshot.engine);
    setQualification(snapshot.qualification);
    setSelfTest(snapshot.qualification.selfTest);
    setModels(snapshot.modelCatalog.models);
    setCatalogStatus(snapshot.modelCatalog.status);
    setUsage(snapshot.usage);
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
      setQualification,
      setDebugSnapshot,
      setSelfTest,
    }));
    const unsubscribeSnapshot = runtimeApi.onSnapshot(applySnapshot);
    return () => { unsubscribeEvent(); unsubscribeSnapshot(); };
  }, []);

  const activeModel = useMemo(() => {
    if (settings.provider === "custom-openai-compatible") {
      return {
        id: settings.customProvider.modelId,
        label: settings.customProvider.modelId || "Custom model",
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
  const compatible = getCompatibilityIssues(activeModel).length === 0;
  const isRunning = status === "running";
  const engineCanStart = engine.state === "ready" || engine.canStart === true;
  const platformLabel = platformName(engine.platform);
  const starterCommands = engine.platform === "darwin" ? MACOS_STARTER_COMMANDS : WINDOWS_STARTER_COMMANDS;
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
      await runtimeApi.startTask(command.trim());
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
    setSettings((current) => ({ ...current, ...patch }));
    void runtimeApi.setAppearance(patch).then(applySnapshot).catch((caught) => setError(caught instanceof Error ? caught.message : "Appearance could not be saved."));
  }

  function updateReasoning(reasoningEffort: ReasoningEffort) {
    void runtimeApi.setReasoningEffort(reasoningEffort).then(applySnapshot).catch((caught) => setError(caught instanceof Error ? caught.message : "Reasoning setting could not be saved."));
  }

  async function updatePermission(appName: string, level: PermissionLevel, appIdentity?: string) {
    await runtimeApi.setAppPermission(appName, level, appIdentity);
    applySnapshot(await runtimeApi.getSnapshot());
  }

  function useStarter(value: string) {
    setCommand(value);
    composerRef.current?.focus();
  }

  return (
    <div className="app-shell" style={appStyle}>
      <div className="material-layer" aria-hidden="true" />
      <aside className="side-rail" aria-label="OpenUse navigation">
        <BrandLockup />
        <div className="rail-section">
          <div className="rail-label">Workspace</div>
          <button className="rail-link rail-link-active" type="button"><Glyph name="activity" /><span>Control room</span></button>
          <button className="rail-link" type="button" disabled={isRunning} onClick={() => setSettingsOpen(true)}><Glyph name="sliders" /><span>Settings</span></button>
        </div>
        <div className="rail-spacer" />
        <div className="rail-note">
          <div className="rail-note-heading"><span className={`status-dot ${controlReady ? "status-ready" : `status-${engine.state}`}`} />Local runtime</div>
          <p>{controlReady ? `${platformLabel} control is connected.` : engine.platform === "darwin" && selfTest && !selfTest.ok ? "macOS permissions are required." : engine.detail}</p>
          <div className="rail-version">OpenUse 0.2.0 / {platformLabel}</div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark small" aria-hidden="true"><span /></div><span>OpenUse</span></div>
          <div className="topbar-context"><span className={`status-dot ${controlReady ? "status-ready" : `status-${engine.state}`}`} /><span>{controlReady ? `${platformLabel} control ready` : engine.platform === "darwin" && selfTest && !selfTest.ok ? `${platformLabel} permission required` : engine.state === "unsupported" ? `${platformLabel} control unavailable` : `${platformLabel} control offline`}</span></div>
          <div className="topbar-actions">
            <ModelPicker models={models} value={settings.provider === "vercel-gateway" ? settings.modelId : settings.customProvider.modelId} onSelect={(modelId) => { if (settings.provider === "vercel-gateway") void runtimeApi.setModel(modelId).then(applySnapshot); }} compact disabled={isRunning || settings.provider !== "vercel-gateway"} />
            <div className="topbar-reasoning"><span>Reasoning</span><ReasoningSelect model={activeModel} value={effectiveReasoning} onChange={updateReasoning} compact disabled={isRunning} /></div>
            <SpendPill taskCost={taskCost} total={usage.totalKnownSpend} />
            <button className="icon-button" type="button" aria-label="Open Settings" disabled={isRunning} onClick={() => setSettingsOpen(true)}><Glyph name="sliders" /></button>
          </div>
        </header>

        <div className="compact-nav" aria-label="Compact navigation"><button className="compact-nav-active" type="button"><Glyph name="activity" />Activity</button><button type="button" disabled={isRunning} onClick={() => setSettingsOpen(true)}><Glyph name="sliders" />Settings</button></div>

        <div className="content-wrap">
          <section className="intro-row" aria-labelledby="page-title">
            <div><div className="eyebrow"><span className="eyebrow-line" />Local Computer Use</div><h1 id="page-title">Put the next action in motion.</h1><p className="intro-copy">Give OpenUse a clear command. It observes your desktop, acts through guarded tools, and shows you what changed.</p></div>
            <div className="intro-meta"><div className="meta-label">Current model</div><div className="meta-value">{activeModel.label}</div><div className="model-detail-id">{activeModel.id}</div><div className="capability-row"><span className={`capability ${activeModel.capabilities.vision ? "" : "capability-disabled"}`}><Glyph name="spark" />{activeModel.capabilities.vision ? "Vision" : "No vision"}</span><span className={`capability ${activeModel.capabilities.toolCalling ? "" : "capability-disabled"}`}><Glyph name="tool" />{activeModel.capabilities.toolCalling ? "Tools" : "No tools"}</span></div></div>
          </section>

          {error && <div className="inline-alert" role="alert"><Glyph name="alert" /><span>{error}</span><button type="button" onClick={() => setError(undefined)} aria-label="Dismiss error">x</button></div>}
          {engine.platform === "darwin" && selfTest && !selfTest.ok && <MacPermissionSetup selfTest={selfTest} />}

          <div className="workspace-grid">
            <section className="activity-surface" aria-labelledby="activity-heading">
              <div className="surface-header"><div><div className="surface-kicker">Current task</div><h2 id="activity-heading">Activity</h2></div><div className={`state-badge state-${status}`}><span className="state-pulse" />{statusLabel(status)}</div></div>
              <div className="timeline" aria-live="polite">{entries.length === 0 ? <EmptyActivity commands={starterCommands} onStarter={useStarter} /> : entries.map((entry) => entry.kind === "user" ? <UserEntry key={entry.id} command={entry.command} /> : <ActionEntry key={entry.action.actionId} action={entry.action} />)}</div>
              <div className="activity-footer">
                <div className="activity-metrics"><span>{isRunning ? <><span className="spinner" />Step {step || 1} / {actionCount} actions</> : `${actionCount} actions`}</span><span>Task spend <strong>{formatMoney(taskCost)}</strong></span><span>20-step estimate <Estimate model={activeModel} usage={usage} /></span></div>
                <div className="composer"><textarea ref={composerRef} value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runTask(); }} placeholder="Tell OpenUse what to do..." aria-label="Task command" rows={2} disabled={isRunning} /><div className="composer-bottom"><span className="composer-hint">Ctrl + Enter to run</span>{isRunning ? <button className="stop-button" type="button" onClick={() => void stopTask()}><span className="stop-square" />Stop task</button> : <button className="run-button" type="button" disabled={!command.trim()} onClick={() => void runTask()}><span>Run task</span><Glyph name="arrow" /></button>}</div></div>
              </div>
            </section>

            <Inspector engine={engine} model={activeModel} status={status} controlReady={controlReady} platformLabel={platformLabel} taskCost={taskCost} totalSpend={usage.totalKnownSpend} onSettings={() => setSettingsOpen(true)} qualification={qualification} debug={debugSnapshot} selfTest={selfTest} />
          </div>
        </div>
      </main>

      {permission && <PermissionDialog request={permission} onDecision={(decision) => { void runtimeApi.decidePermission(permission.id, decision); setPermission(undefined); }} onStop={() => { setPermission(undefined); void stopTask(); }} />}
      {settingsOpen && <SettingsDialog settings={settings} models={models} catalogStatus={catalogStatus} usage={usage} apiKeyDraft={apiKeyDraft} customKeyDraft={customKeyDraft} onApiKeyChange={setApiKeyDraft} onCustomKeyChange={setCustomKeyDraft} onClose={() => setSettingsOpen(false)} onSaveGateway={(modelId) => void saveGateway(modelId)} onSaveCustom={saveCustomProvider} onTestConnection={(modelId) => void testConnection(modelId)} connectionTest={connectionTest} onProvider={(provider) => void runtimeApi.setProvider(provider).then(applySnapshot)} onReasoning={updateReasoning} onAppearance={updateAppearance} onRefreshModels={() => void runtimeApi.refreshModelCatalog().then(applySnapshot)} onResetUsage={() => void runtimeApi.resetUsage().then(applySnapshot)} onPermissionChange={(appName, level, appIdentity) => void updatePermission(appName, level, appIdentity)} onRunSelfTest={() => void runtimeApi.runSelfTest()} onOpenMacPrivacy={(area) => void runtimeApi.openMacPrivacy(area)} />}
    </div>
  );
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
  setQualification: Dispatch<SetStateAction<QualificationSessionInfo>>;
  setDebugSnapshot: Dispatch<SetStateAction<QualificationDebugSnapshot | undefined>>;
  setSelfTest: Dispatch<SetStateAction<EngineSelfTestResult | undefined>>;
}) {
  switch (event.type) {
    case "task.started":
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
    case "qualification.debug": setters.setDebugSnapshot(event.debug); break;
    case "qualification.self-test": setters.setSelfTest(event.result); break;
  }
}

function BrandLockup() { return <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><div><div className="brand-name">OpenUse</div><div className="brand-caption">computer runtime</div></div></div>; }

function Inspector({ engine, model, status, controlReady, platformLabel, taskCost, totalSpend, onSettings, qualification, debug, selfTest }: { engine: EngineStatus; model: ModelDefinition; status: AgentStatus; controlReady: boolean; platformLabel: string; taskCost: number; totalSpend: number; onSettings(): void; qualification: QualificationSessionInfo; debug?: QualificationDebugSnapshot; selfTest?: EngineSelfTestResult }) {
  const content = <>
    <section className="inspector-section engine-section"><div className="section-heading"><span className="section-icon"><Glyph name="desktop" /></span><span>Computer state</span></div><div className="engine-title"><span className={`large-status-dot ${controlReady ? "status-ready" : `status-${engine.state}`}`} />{controlReady ? `${platformLabel} desktop` : `${platformLabel} control`}</div><p className="engine-copy">{controlReady ? "Actions stay local. Native accessibility is preferred; screenshots are used only when needed." : engine.detail}</p><div className="engine-rule" /><div className="engine-foot"><span>Protocol</span><strong>JSON-lines / stdio</strong></div></section>
    <section className="inspector-section usage-section"><div className="section-heading"><span className="section-icon"><Glyph name="chart" /></span><span>Usage</span></div><div className="usage-emphasis">{formatMoney(taskCost)}</div><div className="usage-label">This task</div><div className="usage-row"><span>OpenUse total</span><strong>{formatMoney(totalSpend)}</strong></div><button className="text-button" type="button" disabled={status === "running"} onClick={onSettings}>View usage <Glyph name="arrow" /></button></section>
    <section className="inspector-section model-section"><div className="section-heading"><span className="section-icon"><Glyph name="spark" /></span><span>Model</span></div><div className="model-detail-name">{model.label}</div><div className="model-detail-id">{model.id}</div><div className={`model-compatibility ${getCompatibilityIssues(model).length === 0 ? "compatible" : "incompatible"}`}>{getCompatibilityIssues(model).length === 0 ? "Ready for Computer Use" : getCompatibilityIssues(model).join(" ")}</div><div className="capability-checks"><span className={model.capabilities.toolCalling ? "" : "capability-missing"}><Glyph name={model.capabilities.toolCalling ? "check" : "alert"} />Tool calling</span><span className={model.capabilities.vision ? "" : "capability-missing"}><Glyph name={model.capabilities.vision ? "check" : "alert"} />Vision</span></div></section>
    <section className="inspector-section safety-section"><div className="section-heading"><span className="section-icon"><Glyph name="shield" /></span><span>Safety posture</span></div><ul className="safety-list"><li><Glyph name="check" /><span>Semantic UI before coordinates</span></li><li><Glyph name="check" /><span>App permissions on every control path</span></li><li><Glyph name="check" /><span>Stop cancels model and native work</span></li></ul><button className="text-button" type="button" disabled={status === "running"} onClick={onSettings}>Review permissions <Glyph name="arrow" /></button></section>
    {qualification.enabled && <QualificationPanel engine={engine} debug={debug} selfTest={selfTest} />}
  </>;
  return <><aside className="inspector-column" aria-label="Runtime details">{content}</aside><details className="inspector-drawer"><summary>Runtime details <Glyph name="chevron" /></summary><div className="drawer-content">{content}</div></details></>;
}

function MacPermissionSetup({ selfTest }: { selfTest: EngineSelfTestResult }) {
  const permissionState = (value: EngineSelfTestResult["accessibilityPermission"]): string => value === "granted" ? "Granted" : value === "denied" ? "Not granted" : "Unknown";
  return <section className="privacy-setup" role="alert" aria-labelledby="privacy-setup-title"><div className="privacy-setup-heading"><div><div className="eyebrow"><span className="eyebrow-line" />Computer control setup</div><h2 id="privacy-setup-title">OpenUse needs two macOS permissions.</h2></div><Glyph name="shield" /></div><p>These permissions stay under macOS control. OpenUse will not start a Computer Use task until both are granted.</p><div className="privacy-setup-list"><div className="privacy-setup-row"><div><strong>Accessibility</strong><span>Control buttons, fields, and windows semantically.</span></div><div className={`privacy-state ${selfTest.accessibilityPermission === "granted" ? "privacy-state-granted" : ""}`}>{permissionState(selfTest.accessibilityPermission)}</div><button className="secondary-action" type="button" onClick={() => void runtimeApi.openMacPrivacy("accessibility")}>Open Settings</button></div><div className="privacy-setup-row"><div><strong>Screen Recording</strong><span>Inspect the desktop when visual feedback is needed.</span></div><div className={`privacy-state ${selfTest.screenRecordingPermission === "granted" ? "privacy-state-granted" : ""}`}>{permissionState(selfTest.screenRecordingPermission)}</div><button className="secondary-action" type="button" onClick={() => void runtimeApi.openMacPrivacy("screen-recording")}>Open Settings</button></div></div><div className="privacy-setup-actions"><span>{selfTest.detail ?? "Grant both permissions in System Settings, then recheck."}</span><button className="secondary-action" type="button" onClick={() => void runtimeApi.runSelfTest()}>Recheck</button><button className="primary-action" type="button" onClick={() => void runtimeApi.relaunch()}>Relaunch OpenUse</button></div></section>;
}

function EmptyActivity({ commands, onStarter }: { commands: string[]; onStarter(value: string): void }) { return <div className="empty-activity"><div className="empty-orbit" aria-hidden="true"><span className="orbit-core" /><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /></div><div className="empty-title">Your computer, on request.</div><p>Start with a small task. OpenUse will observe, act, and verify each step.</p><div className="starter-list">{commands.map((starter) => <button type="button" key={starter} onClick={() => onStarter(starter)}>{starter}<Glyph name="arrow" /></button>)}</div></div>; }
function UserEntry({ command }: { command: string }) { return <div className="timeline-entry user-entry"><div className="entry-avatar user-avatar">You</div><div className="entry-body"><div className="entry-label">User</div><div className="user-command">{command}</div></div></div>; }
function ActionEntry({ action }: { action: TimelineAction }) { const failed = action.status === "failed"; return <div className={`timeline-entry action-entry action-${action.status}`}><div className={`entry-status ${failed ? "entry-status-failed" : action.status === "completed" ? "entry-status-done" : "entry-status-active"}`}>{failed ? <Glyph name="alert" /> : action.status === "completed" ? <Glyph name="check" /> : <span className="mini-spinner" />}</div><div className="entry-body"><div className="action-line"><span>{action.summary}</span>{action.durationMs !== undefined && <time>{formatDuration(action.durationMs)}</time>}</div>{action.detail && <div className="entry-detail">{action.detail}</div>}{failed && <div className="entry-error">{action.errorMessage}</div>}</div></div>; }

function PermissionDialog({ request, onDecision, onStop }: { request: PermissionRequest; onDecision(decision: PermissionDecision): void; onStop(): void }) { const denyRef = useRef<HTMLButtonElement>(null); const persistentApprovalAllowed = request.risk === "read" || request.risk === "interaction"; useEffect(() => { denyRef.current?.focus(); const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onStop(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [onStop]); return <div className="modal-backdrop permission-backdrop" role="presentation"><div className="permission-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permission-title" aria-describedby="permission-description"><div className="permission-icon"><Glyph name="shield" /></div><div className="dialog-eyebrow">Permission required</div><h2 id="permission-title">Allow OpenUse to control {request.appName}?</h2><p id="permission-description">OpenUse wants to <strong>{request.actionSummary}</strong>. The runtime classified this as <span className="risk-label">{request.risk}</span>.</p><div className="permission-reason"><span>Why you're seeing this</span><p>{request.reason}</p></div><div className="dialog-actions"><button ref={denyRef} className="secondary-action" type="button" onClick={() => onDecision("deny")}>Deny</button><button className="secondary-action" type="button" onClick={() => onDecision("allow-once")}>Allow once</button>{persistentApprovalAllowed && <button className="primary-action" type="button" onClick={() => onDecision("always-allow")}>Always allow</button>}<button className="stop-dialog-action" type="button" onClick={onStop}>Stop task</button></div></div></div>; }

function SettingsDialog({ settings, models, catalogStatus, usage, apiKeyDraft, customKeyDraft, onApiKeyChange, onCustomKeyChange, onClose, onSaveGateway, onSaveCustom, onTestConnection, connectionTest, onProvider, onReasoning, onAppearance, onRefreshModels, onResetUsage, onPermissionChange, onRunSelfTest, onOpenMacPrivacy }: {
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
  const sections: Array<[SettingsSection, string, string]> = [["ai", "AI", "Models and providers"], ["appearance", "Appearance", "Color and material"], ["usage", "Usage", "Spend recorded locally"], ["permissions", "Permissions", "Apps OpenUse may control"], ["advanced", "Advanced", "Runtime diagnostics"]];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialogRef}><div className="dialog-topline"><div><div className="dialog-eyebrow">OpenUse configuration</div><h2 id="settings-title">Settings</h2></div><button className="close-button" type="button" aria-label="Close Settings" onClick={onClose}>x</button></div><div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{sections.map(([id, label, description]) => <button type="button" key={id} className={section === id ? "settings-nav-active" : ""} onClick={() => setSection(id)}><span>{label}</span><small>{description}</small></button>)}</nav><div className="settings-content">{section === "ai" && <><AISettings settings={settings} models={models} catalogStatus={catalogStatus} modelId={modelId} setModelId={setModelId} apiKeyDraft={apiKeyDraft} onApiKeyChange={onApiKeyChange} customKeyDraft={customKeyDraft} onCustomKeyChange={onCustomKeyChange} customBaseUrl={customBaseUrl} setCustomBaseUrl={setCustomBaseUrl} customModelId={customModelId} setCustomModelId={setCustomModelId} customCapabilities={customCapabilities} setCustomCapabilities={setCustomCapabilities} onProvider={onProvider} onSaveGateway={onSaveGateway} onSaveCustom={onSaveCustom} onTestConnection={onTestConnection} connectionTest={connectionTest} onRefreshModels={onRefreshModels} /><div className="settings-divider" /><ReasoningSettings model={settings.provider === "vercel-gateway" ? models.find((model) => model.id === settings.modelId) : { id: settings.customProvider.modelId, label: settings.customProvider.modelId, provider: "custom-openai-compatible", capabilities: settings.customProvider.capabilities }} value={settings.reasoningEffort} onReasoning={onReasoning} /></>}{section === "appearance" && <AppearanceSettings settings={settings} onAppearance={onAppearance} />}{section === "usage" && <UsageSettings usage={usage} onReset={onResetUsage} />}{section === "permissions" && <PermissionsSettings settings={settings} onPermissionChange={onPermissionChange} />}{section === "advanced" && <AdvancedSettings settings={settings} catalogStatus={catalogStatus} onRunSelfTest={onRunSelfTest} onOpenMacPrivacy={onOpenMacPrivacy} />}</div></div><div className="dialog-footer"><span className="settings-status"><span className={`status-dot ${settings.provider === "vercel-gateway" ? (settings.apiKeyConfigured ? "status-ready" : "status-offline") : "status-ready"}`} />{settings.provider === "vercel-gateway" ? (settings.apiKeyConfigured ? "Gateway key configured" : "Gateway key needed") : "Custom endpoint selected"}</span><button className="secondary-action" type="button" onClick={onClose}>Done</button></div></div></div>;
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
  return <div className="settings-section"><div className="settings-section-heading"><div><div className="dialog-eyebrow">AI</div><h3>Choose how OpenUse thinks.</h3></div><span className="catalog-status">{catalogStatus.count} models / {catalogStatus.source === "gateway-live" ? "live" : catalogStatus.source === "gateway-cache" ? "cached" : "fallback"}</span></div><div className="provider-tabs"><button type="button" className={settings.provider === "vercel-gateway" ? "provider-tab-active" : ""} onClick={() => onProvider("vercel-gateway")}>Vercel AI Gateway</button><button type="button" className={settings.provider === "custom-openai-compatible" ? "provider-tab-active" : ""} onClick={() => onProvider("custom-openai-compatible")}>Custom endpoint</button></div>{settings.provider === "vercel-gateway" ? <><div className="settings-field"><div className="field-label-row"><label>Computer Use model</label><button className="link-button" type="button" onClick={onRefreshModels} disabled={catalogStatus.isRefreshing}>{catalogStatus.isRefreshing ? "Refreshing..." : "Refresh catalog"}</button></div><ModelPicker models={models} value={modelId} onSelect={setModelId} /><div className="field-note">Showing models that advertise both tool calling and visual input. The catalog is validated and cached locally.</div></div><div className="settings-field"><label htmlFor="gateway-key">API key</label><input id="gateway-key" type="password" autoComplete="off" value={apiKeyDraft} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={settings.apiKeyConfigured ? "Key saved - enter a new key to replace it" : "Paste your AI_GATEWAY_API_KEY"} /><div className="field-note"><Glyph name="lock" /> Stored locally with OS-backed encryption. Never returned to the renderer.</div></div><div className="connection-test"><button className="secondary-action" type="button" disabled={connectionTest === "testing"} onClick={() => onTestConnection(modelId)}>{connectionTest === "testing" ? "Testing..." : "Test connection"}</button>{connectionTest !== "idle" && connectionTest !== "testing" && <span className={connectionTest.ok ? "connection-success" : "connection-failure"}>{connectionTest.message}</span>}</div><button className="primary-action settings-save" type="button" onClick={() => onSaveGateway(modelId)}>Save Gateway settings</button></> : <CustomProviderSettings baseUrl={customBaseUrl} setBaseUrl={setCustomBaseUrl} modelId={customModelId} setModelId={setCustomModelId} capabilities={customCapabilities} setCapabilities={setCustomCapabilities} keyDraft={customKeyDraft} onKeyChange={onCustomKeyChange} configured={settings.customProvider.apiKeyConfigured} onSave={() => onSaveCustom({ baseUrl: customBaseUrl, modelId: customModelId, capabilities: customCapabilities })} />}</div>;
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

function CustomProviderSettings({ baseUrl, setBaseUrl, modelId, setModelId, capabilities, setCapabilities, keyDraft, onKeyChange, configured, onSave }: CustomProviderSettingsProps) { const setPreset = (url: string, model: string) => { setBaseUrl(url); setModelId(model); }; return <div className="custom-provider-block"><div className="settings-field"><label>Endpoint preset</label><div className="preset-row"><button className="secondary-action" type="button" onClick={() => setPreset("http://localhost:11434/v1", "llama3.2-vision")}>Ollama</button><button className="secondary-action" type="button" onClick={() => setPreset("http://localhost:1234/v1", "local-model")}>LM Studio</button></div></div><div className="settings-field"><label htmlFor="custom-base-url">Base URL</label><input id="custom-base-url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" /></div><div className="settings-field"><label htmlFor="custom-model-id">Model ID</label><input id="custom-model-id" value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="llama3.2-vision" /><div className="field-note">OpenAI-compatible chat completions endpoint. OpenUse does not infer local model capabilities.</div></div><div className="settings-field"><label htmlFor="custom-key">API key <span className="optional-label">optional</span></label><input id="custom-key" type="password" autoComplete="off" value={keyDraft} onChange={(event) => onKeyChange(event.target.value)} placeholder={configured ? "Key saved - enter a new key to replace it" : "Leave blank for local servers"} /></div><div className="capability-config"><div className="capability-config-title">Declare endpoint capabilities</div>{([ ["toolCalling", "Tool calling", "Required for Computer Use"], ["vision", "Visual input", "Required for Computer Use"], ["reasoning", "Configurable reasoning", "Allows reasoning controls"] ] as const).map(([key, label, note]) => <label key={key} className="check-row"><input type="checkbox" checked={capabilities[key]} onChange={(event) => setCapabilities({ ...capabilities, [key]: event.target.checked })} /><span><strong>{label}</strong><small>{note}</small></span></label>)}</div><div className="custom-warning"><Glyph name="alert" />Custom endpoints do not provide trusted pricing metadata. Cost is shown as unknown.</div><button className="primary-action settings-save" type="button" onClick={onSave}>Use custom endpoint</button></div>; }

function ReasoningSettings({ model, value, onReasoning }: { model?: ModelDefinition; value: ReasoningEffort; onReasoning(value: ReasoningEffort): void }) { return <div className="settings-field"><label>Reasoning level</label><ReasoningSelect model={model} value={value} onChange={onReasoning} /><div className="field-note">Only levels advertised by the selected model are sent. Unsupported choices fall back to Provider default.</div></div>; }

function AppearanceSettings({ settings, onAppearance }: { settings: AppSettings; onAppearance(patch: { primaryColor?: string; backgroundBlur?: number; backgroundOpacity?: number; showAgentCursor?: boolean }): void }) { const presets = ["#c8f36a", "#8bd5ff", "#ffb86b", "#d9a7ff", "#f3f3f3"]; return <div className="settings-section"><div className="dialog-eyebrow">Appearance</div><h3>One signal color. A window that recedes.</h3><p className="settings-lede">OpenUse uses black, white, and one selected primary. The native material lets the desktop remain present while controls stay crisp.</p><div className="settings-field"><label>Primary color</label><div className="color-presets">{presets.map((color) => <button key={color} className={`color-swatch ${settings.primaryColor === color ? "color-swatch-selected" : ""}`} style={{ backgroundColor: color }} type="button" aria-label={`Use ${color}`} onClick={() => onAppearance({ primaryColor: color })}><span /></button>)}<input className="color-picker" type="color" value={settings.primaryColor} onChange={(event) => onAppearance({ primaryColor: event.target.value })} aria-label="Custom primary color" /></div><div className="hex-input"><span>#</span><input aria-label="Primary color HEX" value={settings.primaryColor.replace(/^#/, "")} maxLength={6} onChange={(event) => { const value = event.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 6); if (value.length === 6) onAppearance({ primaryColor: `#${value}` }); }} /><span className="color-preview" style={{ backgroundColor: settings.primaryColor }} /></div></div><RangeField id="background-blur" label="Background blur" value={settings.backgroundBlur} min={0} max={40} step={1} suffix="px" onChange={(value) => onAppearance({ backgroundBlur: value })} /><RangeField id="background-opacity" label="Background opacity" value={Math.round(settings.backgroundOpacity * 100)} min={45} max={100} step={1} suffix="%" onChange={(value) => onAppearance({ backgroundOpacity: value / 100 })} /><label className="toggle-row"><span><strong>Show OpenUse cursor</strong><small>Show the virtual target overlay while the agent acts.</small></span><input type="checkbox" checked={settings.showAgentCursor} onChange={(event) => onAppearance({ showAgentCursor: event.target.checked })} /><span className="toggle-control" /></label></div>; }

function RangeField({ id, label, value, min, max, step, suffix, onChange }: { id: string; label: string; value: number; min: number; max: number; step: number; suffix: string; onChange(value: number): void }) { return <div className="settings-field range-field"><div className="field-label-row"><label htmlFor={id}>{label}</label><output htmlFor={id}>{value}{suffix}</output></div><input id={id} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></div>; }

function UsageSettings({ usage, onReset }: { usage: UsageSummary; onReset(): void }) { return <div className="settings-section"><div className="dialog-eyebrow">Usage</div><h3>Spend recorded through this installation.</h3><div className="usage-grid"><Metric label="Known spend" value={formatMoney(usage.totalKnownSpend)} /><Metric label="Completed tasks" value={String(usage.completedTasks)} /><Metric label="Input tokens" value={formatInteger(usage.inputTokens)} /><Metric label="Output tokens" value={formatInteger(usage.outputTokens)} /><Metric label="Average task" value={usage.averageTaskCost === undefined ? "-" : formatMoney(usage.averageTaskCost)} /><Metric label="Unpriced requests" value={String(usage.unpricedRequests)} /></div><p className="field-note">Only model IDs, token counts, action counts, timing, status, reasoning level, and known cost are stored. Commands, screenshots, accessibility content, credentials, and chain-of-thought are not written.</p><div className="settings-divider" /><div className="settings-section-heading"><div><div className="dialog-eyebrow">Recent model usage</div><h4>Where requests are going</h4></div></div><div className="model-usage-list">{usage.modelUsage.length === 0 ? <div className="empty-note">Usage appears after the first model request.</div> : usage.modelUsage.slice(0, 12).map((model) => <div className="model-usage-row" key={`${model.provider}:${model.modelId}`}><div><strong>{model.modelId}</strong><span>{model.provider} / {model.requestCount} requests</span></div><strong>{formatMoney(model.knownSpend)}</strong></div>)}</div><button className="danger-outline" type="button" onClick={() => { if (window.confirm("Reset local usage history? This cannot be undone.")) onReset(); }}>Reset local usage history</button></div>; }

function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }

function PermissionsSettings({ settings, onPermissionChange }: { settings: AppSettings; onPermissionChange(appName: string, level: PermissionLevel, appIdentity?: string): void }) { return <div className="settings-section"><div className="dialog-eyebrow">Permissions</div><h3>Who can OpenUse control?</h3><p className="settings-lede">App permissions apply to semantic actions, coordinate fallback, screenshots, and keyboard input. Safety risk still determines whether a confirmation is required.</p><div className="permission-list">{settings.permissions.map((record) => <div className="permission-row" key={record.appIdentity ?? record.appName}><div><div className="permission-app">{record.appName}</div><div className="permission-updated">{record.level === "ALLOW" ? "Control allowed" : record.level === "DENY" ? "Control blocked" : "Ask each time"}</div></div><div className="select-wrap permission-select"><select aria-label={`${record.appName} permission`} value={record.level} onChange={(event) => onPermissionChange(record.appName, event.target.value as PermissionLevel, record.appIdentity)}><option>ALLOW</option><option>ASK</option><option>DENY</option></select><Glyph name="chevron" /></div></div>)}</div></div>; }

function AdvancedSettings({ settings, catalogStatus, onRunSelfTest, onOpenMacPrivacy }: { settings: AppSettings; catalogStatus: ModelCatalogStatus; onRunSelfTest(): void; onOpenMacPrivacy(area: "accessibility" | "screen-recording"): void }) { return <div className="settings-section"><div className="dialog-eyebrow">Advanced</div><h3>Runtime details.</h3><div className="advanced-list"><div><span>Provider</span><strong>{settings.provider}</strong></div><div><span>Catalog</span><strong>{catalogStatus.source} / {catalogStatus.count} models</strong></div><div><span>Cursor</span><strong>{settings.showAgentCursor ? "Visible during tasks" : "Hidden"}</strong></div><div><span>Storage</span><strong>Local, atomic, privacy-safe</strong></div></div><div className="settings-divider" /><div className="advanced-actions"><button className="secondary-action" type="button" onClick={onRunSelfTest}>Run native self-test</button>{settings.provider === "vercel-gateway" && <span>Runtime information stays in the local process.</span>}{settings.customProvider.baseUrl && <span>Custom endpoint: {settings.customProvider.baseUrl}</span>}</div><div className="settings-divider" /><div className="advanced-actions"><strong>Safety boundaries</strong><span>OpenUse does not expose arbitrary shells, unrestricted filesystems, credential capture, hidden remote access, or software installation to the model.</span></div>{navigator.platform.toLowerCase().includes("mac") && <div className="advanced-actions"><button className="secondary-action" type="button" onClick={() => onOpenMacPrivacy("accessibility")}>Open Accessibility settings</button><button className="secondary-action" type="button" onClick={() => onOpenMacPrivacy("screen-recording")}>Open Screen Recording settings</button></div>}</div>; }

function ModelPicker({ models, value, onSelect, compact = false, disabled = false }: { models: ModelDefinition[]; value: string; onSelect(modelId: string): void; compact?: boolean; disabled?: boolean }) { const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [showAll, setShowAll] = useState(false); const [provider, setProvider] = useState("all"); const compatibleModels = models.filter((model) => getCompatibilityIssues(model).length === 0); const source = showAll ? models : compatibleModels; const providers = [...new Set(source.map((model) => model.sourceProvider || "other"))].sort(); const filtered = source.filter((model) => (provider === "all" || (model.sourceProvider || "other") === provider) && `${model.label} ${model.id} ${model.description ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 120); const selected = models.find((model) => model.id === value); return <div className={`model-picker-control ${compact ? "model-picker-compact" : ""}`}><button className="model-picker-trigger" type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? value}</span><small>{selected?.id ?? value}</small><Glyph name="chevron" /></button>{open && <div className="model-picker-popover"><div className="model-picker-search"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models or IDs" aria-label="Search models" /><button type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "Computer Use only" : "Show all models"}</button></div><div className="model-picker-filters"><button className={provider === "all" ? "filter-active" : ""} type="button" onClick={() => setProvider("all")}>All providers</button>{providers.map((item) => <button className={provider === item ? "filter-active" : ""} type="button" key={item} onClick={() => setProvider(item)}>{item}</button>)}</div><div className="model-picker-list" role="listbox">{filtered.length === 0 ? <div className="empty-note">No models match this search.</div> : filtered.map((model) => <button className={`model-option ${model.id === value ? "model-option-selected" : ""}`} role="option" aria-selected={model.id === value} type="button" key={model.id} onClick={() => { onSelect(model.id); setOpen(false); }}><span className="model-option-top"><strong>{model.label}</strong><small>{model.sourceProvider || "Gateway"}</small></span><span className="model-option-id">{model.id}</span><span className="model-option-meta"><span className={model.capabilities.vision ? "" : "meta-missing"}>{model.capabilities.vision ? "Vision" : "No vision"}</span><span className={model.capabilities.toolCalling ? "" : "meta-missing"}>{model.capabilities.toolCalling ? "Tools" : "No tools"}</span><span>{model.capabilities.reasoning ? "Reasoning" : "Provider default"}</span><span>Input {formatModelPrice(model.pricing?.inputPerToken, model.pricing?.inputTiers)}</span><span>Output {formatModelPrice(model.pricing?.outputPerToken, model.pricing?.outputTiers)}</span></span>{showAll && getCompatibilityIssues(model).length > 0 && <span className="model-option-warning">Unavailable for Computer Use: {getCompatibilityIssues(model).join(" ")}</span>}</button>)}</div><div className="model-picker-foot">{filtered.length >= 120 ? "Showing the first 120 matches." : `${filtered.length} models`} / catalog {catalogAgeLabel(models)}</div></div>}</div>; }

function ReasoningSelect({ model, value, onChange, compact = false, disabled = false }: { model?: ModelDefinition; value: ReasoningEffort; onChange(value: ReasoningEffort): void; compact?: boolean; disabled?: boolean }) { const supported: ReasoningEffort[] = model?.capabilities.reasoning ? model.capabilities.reasoningEfforts ?? ["provider-default"] : ["provider-default"]; return <div className={`select-wrap reasoning-select ${compact ? "reasoning-select-compact" : ""}`}><select aria-label="Reasoning level" value={supported.includes(value) ? value : "provider-default"} disabled={disabled || supported.length <= 1} onChange={(event) => onChange(event.target.value as ReasoningEffort)}>{supported.map((effort) => <option value={effort} key={effort}>{reasoningLabel(effort)}</option>)}</select><Glyph name="chevron" /></div>; }

function SpendPill({ taskCost, total }: { taskCost: number; total: number }) { return <div className="spend-pill" title="Known cost reported by the provider during this task and through this OpenUse installation"><span>Spend</span><strong>{formatMoney(taskCost)}</strong><small>/ {formatMoney(total)} total</small></div>; }
function Estimate({ model, usage }: { model: ModelDefinition; usage: UsageSummary }) { const profile = profileFromUsage(model, usage); const estimate = estimateTwentyStepCost(model, profile); return <span className="estimate" title="Approximate 20-step estimate based on recent local token usage and current catalog pricing. It is not a guarantee.">≈ {estimate === undefined ? "unavailable" : formatMoney(estimate)}</span>; }
function profileFromUsage(model: ModelDefinition, usage: UsageSummary) { const own = usage.modelUsage.find((item) => item.modelId === model.id); const source = own ?? (usage.modelUsage.length > 0 ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, requestCount: usage.modelUsage.reduce((sum, item) => sum + item.requestCount, 0) } : undefined); return source && source.requestCount > 0 ? { inputTokensPerStep: source.inputTokens / source.requestCount, outputTokensPerStep: source.outputTokens / source.requestCount, source: own ? "model" as const : "general" as const } : undefined; }
function catalogAgeLabel(models: ModelDefinition[]) { const model = models.find((item) => item.createdAt || item.releasedAt); return model?.releasedAt ? "dated" : "local"; }
function formatModelPrice(direct: number | undefined, tiers: Array<{ perToken: number }> | undefined): string { const price = direct ?? tiers?.[0]?.perToken; return price === undefined ? "unavailable" : `${tiers && direct === undefined ? "from " : ""}${formatPricePerMillion(price)}`; }

function QualificationPanel({ engine, debug, selfTest }: { engine: EngineStatus; debug?: QualificationDebugSnapshot; selfTest?: EngineSelfTestResult }) { const platformLabel = platformName(engine.platform); return <section className="inspector-section qualification-section"><div className="section-heading"><span className="section-icon"><Glyph name="tool" /></span><span>Qualification mode</span></div><div className="qualification-status"><span className={`status-dot status-${engine.state}`} />{platformLabel} controller <strong>{engine.state === "ready" ? "Connected" : engine.state === "offline" ? "Offline" : engine.state}</strong></div><div className="qualification-grid"><span>PID</span><strong>{engine.pid ?? "-"}</strong><span>Protocol</span><strong>{engine.protocol ?? "-"}</strong><span>Heartbeat</span><strong>{engine.lastHeartbeatAt ? formatTimestamp(engine.lastHeartbeatAt) : "-"}</strong><span>Last action</span><strong>{engine.lastAction ?? "-"}</strong></div>{selfTest && <><div className={`self-test-result ${selfTest.ok ? "self-test-pass" : "self-test-fail"}`}><span>{selfTest.ok ? "Self-test passed" : "Self-test failed"}</span><span>{selfTest.monitorCount} monitor{selfTest.monitorCount === 1 ? "" : "s"}</span></div><div className="self-test-details">{selfTest.accessibilityPermission && <span>Accessibility: {selfTest.accessibilityPermission}</span>}{selfTest.screenRecordingPermission && <span>Screen Recording: {selfTest.screenRecordingPermission}</span>}{selfTest.monitors.map((monitor) => <span key={monitor.index}>Display {monitor.index + 1}: {monitor.dpi} DPI / {monitor.scaleFactor ?? 1}x / {monitor.bounds.width}x{monitor.bounds.height}</span>)}{selfTest.screenshot && <span>Capture: {selfTest.screenshot.width}x{selfTest.screenshot.height} / origin ({selfTest.screenshot.captureBounds.x}, {selfTest.screenshot.captureBounds.y})</span>}</div></>}{debug && <><div className="debug-rule" /><div className="debug-label">Last runtime observation</div><div className="debug-summary"><strong>{debug.tool}</strong><span>{debug.result} / action {debug.actionCount} / retry {debug.retryCount}</span></div><div className="debug-summary"><span>Method</span><strong>{debug.interactionMethod ?? "not an interaction"}</strong></div>{debug.targetElementId && <div className="debug-summary"><span>Element</span><strong>{debug.targetElementId}</strong></div>}{debug.window && <div className="debug-window"><strong>{debug.window.title || debug.window.app}</strong><span>{debug.window.app} / {debug.window.bounds.width}x{debug.window.bounds.height} at ({debug.window.bounds.x}, {debug.window.bounds.y})</span></div>}{debug.screenshot && <div className="debug-window"><strong>Screenshot</strong><span>{debug.screenshot.width}x{debug.screenshot.height} px / origin ({debug.screenshot.originX}, {debug.screenshot.originY})</span></div>}<div className="debug-label">Normalized elements ({debug.elements.length}{debug.truncated ? "+" : ""})</div><div className="debug-elements" role="region" aria-label="Normalized UI Automation elements">{debug.elements.slice(0, 40).map((element) => <div className="debug-element" key={element.id}><strong>{element.id}</strong><span>{element.role} / {element.name || "(unnamed)"}</span><small>{element.automationId || element.className || "-"} / {element.bounds.x},{element.bounds.y} {element.bounds.width}x{element.bounds.height}</small></div>)}</div></>}{!debug && <p className="qualification-note">Start a task to inspect normalized UI state and actual interaction method here. Pixels are never persisted by default.</p>}</section>; }

function RangeValue(value: number): string { return value.toLocaleString("en-US"); }
function formatInteger(value: number): string { return RangeValue(Math.round(value)); }
function formatMoney(value: number): string { return `$${Math.max(0, value).toFixed(4)}`; }
function primaryForeground(hex: string): string { const value = hex.replace("#", ""); if (value.length !== 6) return "#0a0a0a"; const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4); const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]; return luminance > 0.52 ? "#0a0a0a" : "#ffffff"; }
function formatTimestamp(value: string): string { return value.replace("T", " ").replace("Z", " UTC"); }
function platformName(platform: string): string { return platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform === "unknown" ? "Desktop" : platform; }
function statusLabel(status: AgentStatus): string { return status === "idle" ? "Ready" : status === "running" ? "Working" : status === "completed" ? "Completed" : status === "stopped" ? "Stopped" : "Needs attention"; }
function formatDuration(durationMs: number): string { return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`; }
function reasoningLabel(effort: ReasoningEffort): string { return effort === "provider-default" ? "Provider default" : effort === "xhigh" ? "XHigh" : effort[0].toUpperCase() + effort.slice(1); }
type ConnectionTestState = "idle" | "testing" | GatewayConnectionResult;

function Glyph({ name }: { name: GlyphName }) { const paths: Record<GlyphName, string> = { activity: "M3 12h4l2-7 4 14 2-7h6", sliders: "M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4", chevron: "m7 10 5 5 5-5", arrow: "M4 12h15m-6-6 6 6-6 6", spark: "m12 3 1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-2.5L12 3Z", tool: "M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.4-2.4 1.8-2.9Z", desktop: "M4 5h16v11H4zM9 20h6M12 16v4", shield: "M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z", check: "m5 12 4 4L19 6", alert: "M12 4 21 20H3L12 4Zm0 6v4m0 3h.01", lock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3", chart: "M4 19V5m0 14h16M8 16v-5m4 5V7m4 9v-8" }; return <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>; }
type GlyphName = "activity" | "sliders" | "chevron" | "arrow" | "spark" | "tool" | "desktop" | "shield" | "check" | "alert" | "lock" | "chart";
