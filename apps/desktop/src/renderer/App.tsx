import { useEffect, useMemo, useRef, useState } from "react";
import { MODEL_CATALOG } from "@openuse/ai";
import { defaultPermissionRecords } from "@openuse/permissions";
import type {
  AgentStatus,
  AppSettings,
  EngineStatus,
  PermissionDecision,
  PermissionLevel,
  PermissionRequest,
  RuntimeEvent,
  TimelineAction,
} from "@openuse/shared";

type TimelineEntry =
  | { kind: "user"; id: string; command: string }
  | { kind: "action"; action: TimelineAction };

const STARTER_COMMANDS = [
  "Open Notepad and type \"Hello from OpenUse\"",
  "Open Calculator and calculate 37 × 19",
  "Open Notepad, type \"OpenUse test file\", and save it as openuse-test.txt on my Desktop.",
];

const emptyEngine: EngineStatus = {
  platform: "unknown",
  state: "offline",
  detail: "Connecting to the local runtime…",
};

const emptySettings: AppSettings = {
  provider: "vercel-gateway",
  modelId: MODEL_CATALOG[0].id,
  apiKeyConfigured: false,
  permissions: [],
};

const browserPreviewBridge: Window["openuse"] = {
  getSnapshot: async () => ({
    settings: { ...emptySettings, permissions: defaultPermissionRecords() },
    engine: {
      platform: "browser-preview",
      state: "unsupported",
      detail: "OpenUse's desktop bridge is available inside Electron only. Open the desktop app to control Windows.",
    },
  }),
  setModel: async () => undefined,
  saveGatewayApiKey: async () => { throw new Error("Settings are available in the OpenUse desktop app."); },
  startTask: async () => { throw new Error("Computer control is available in the OpenUse desktop app."); },
  stopTask: async () => undefined,
  decidePermission: async () => undefined,
  setAppPermission: async () => undefined,
  onEvent: () => () => undefined,
};

const runtimeApi = window.openuse ?? browserPreviewBridge;

export function App() {
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [engine, setEngine] = useState<EngineStatus>(emptyEngine);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [command, setCommand] = useState("");
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [step, setStep] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const [permission, setPermission] = useState<PermissionRequest | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [error, setError] = useState<string | undefined>();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void runtimeApi.getSnapshot().then((snapshot) => {
      setSettings(snapshot.settings);
      setEngine(snapshot.engine);
    }).catch(() => setError("OpenUse could not load its local settings."));
    return runtimeApi.onEvent((event) => handleRuntimeEvent(event, {
      setEntries,
      setStatus,
      setStep,
      setActionCount,
      setPermission,
      setEngine,
      setError,
    }));
  }, []);

  const activeModel = useMemo(
    () => MODEL_CATALOG.find((model) => model.id === settings.modelId) ?? {
      id: settings.modelId,
      label: settings.modelId,
      provider: "vercel-gateway" as const,
      capabilities: { toolCalling: false, vision: false },
    },
    [settings.modelId],
  );
  const modelCompatible = activeModel.capabilities.toolCalling && activeModel.capabilities.vision;
  const isRunning = status === "running";
  const canRun = Boolean(command.trim()) && !isRunning && settings.apiKeyConfigured && modelCompatible && engine.state === "ready";

  async function runTask() {
    if (!canRun) {
      if (!settings.apiKeyConfigured) {
        setSettingsOpen(true);
        setError("Add your AI Gateway API key in Settings to run a task.");
      } else if (engine.state !== "ready") {
        setError("The Windows engine is not available on this host.");
      } else if (!modelCompatible) {
        setError("Choose a model with both tool calling and vision support for Computer Use.");
      }
      return;
    }
    setError(undefined);
    setEntries([]);
    setStep(0);
    setActionCount(0);
    try {
      await runtimeApi.startTask(command.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OpenUse could not start the task.");
    }
  }

  async function stopTask() {
    await runtimeApi.stopTask();
  }

  async function saveSettings(modelId: string, key: string) {
    try {
      await runtimeApi.setModel(modelId);
      if (key.trim()) await runtimeApi.saveGatewayApiKey(key.trim());
      const snapshot = await runtimeApi.getSnapshot();
      setSettings(snapshot.settings);
      setEngine(snapshot.engine);
      setApiKeyDraft("");
      setSettingsOpen(false);
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings could not be saved.");
    }
  }

  async function updatePermission(appName: string, level: PermissionLevel, appIdentity?: string) {
    await runtimeApi.setAppPermission(appName, level, appIdentity);
    const snapshot = await runtimeApi.getSnapshot();
    setSettings(snapshot.settings);
  }

  function useStarter(value: string) {
    setCommand(value);
    composerRef.current?.focus();
  }

  return (
    <div className="app-shell">
      <aside className="side-rail" aria-label="OpenUse navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div>
            <div className="brand-name">OpenUse</div>
            <div className="brand-caption">computer runtime</div>
          </div>
        </div>

        <div className="rail-section">
          <div className="rail-label">Workspace</div>
          <button className="rail-link rail-link-active" type="button">
            <Glyph name="activity" />
            <span>Control room</span>
          </button>
          <button className="rail-link" type="button" disabled={isRunning} onClick={() => setSettingsOpen(true)}>
            <Glyph name="sliders" />
            <span>Settings</span>
          </button>
        </div>

        <div className="rail-spacer" />
        <div className="rail-note">
          <div className="rail-note-heading"><span className={`status-dot status-${engine.state}`} />Local runtime</div>
          <p>{engine.state === "ready" ? "Windows control is connected." : engine.detail}</p>
          <div className="rail-version">OpenUse MVP · Windows only</div>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark small" aria-hidden="true"><span /></div><span>OpenUse</span></div>
          <div className="topbar-context">
            <span className={`status-dot status-${engine.state}`} />
            <span>{engine.state === "ready" ? "Windows engine ready" : engine.state === "unsupported" ? "Windows engine unavailable" : "Windows engine offline"}</span>
          </div>
          <div className="topbar-actions">
            <label className="model-picker compact-picker">
              <span>Model</span>
              <select
                aria-label="Active model"
                value={settings.modelId}
                onChange={(event) => void runtimeApi.setModel(event.target.value).then(() => setSettings((current) => ({ ...current, modelId: event.target.value })))}
              >
                {MODEL_CATALOG.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}
              </select>
              <Glyph name="chevron" />
            </label>
            <button className="icon-button" type="button" aria-label="Open Settings" disabled={isRunning} onClick={() => setSettingsOpen(true)}>
              <Glyph name="sliders" />
            </button>
          </div>
        </header>

        <div className="content-wrap">
          <section className="intro-row" aria-labelledby="page-title">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" />Local Computer Use</div>
              <h1 id="page-title">Put the next action in motion.</h1>
              <p className="intro-copy">Give OpenUse a clear command. It observes your Windows desktop, acts through guarded tools, and shows you what changed.</p>
            </div>
            <div className="intro-meta">
              <div className="meta-label">Active model</div>
              <div className="meta-value">{activeModel.label}</div>
              <div className="capability-row">
                <span className={`capability ${activeModel.capabilities.vision ? "" : "capability-disabled"}`}><Glyph name="spark" />{activeModel.capabilities.vision ? "Vision" : "No vision"}</span>
                <span className={`capability ${activeModel.capabilities.toolCalling ? "" : "capability-disabled"}`}><Glyph name="tool" />{activeModel.capabilities.toolCalling ? "Tools" : "No tools"}</span>
              </div>
            </div>
          </section>

          {error && <div className="inline-alert" role="alert"><Glyph name="alert" /><span>{error}</span><button type="button" onClick={() => setError(undefined)} aria-label="Dismiss error">×</button></div>}

          <div className="workspace-grid">
            <section className="activity-surface" aria-labelledby="activity-heading">
              <div className="surface-header">
                <div>
                  <div className="surface-kicker">Task timeline</div>
                  <h2 id="activity-heading">Activity</h2>
                </div>
                <div className={`state-badge state-${status}`}><span className="state-pulse" />{statusLabel(status)}</div>
              </div>

              <div className="timeline" aria-live="polite">
                {entries.length === 0 ? (
                  <EmptyActivity onStarter={useStarter} />
                ) : (
                  entries.map((entry) => entry.kind === "user"
                    ? <UserEntry key={entry.id} command={entry.command} />
                    : <ActionEntry key={entry.action.actionId} action={entry.action} />)
                )}
              </div>

              <div className="activity-footer">
                {isRunning && <div className="step-indicator"><span className="spinner" />Step {step || 1} · {actionCount}/30 actions</div>}
                <div className="composer">
                  <textarea
                    ref={composerRef}
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void runTask();
                    }}
                    placeholder="Tell OpenUse what to do…"
                    aria-label="Task command"
                    rows={2}
                    disabled={isRunning}
                  />
                  <div className="composer-bottom">
                    <span className="composer-hint">Ctrl + Enter to run</span>
                    {isRunning ? (
                      <button className="stop-button" type="button" onClick={() => void stopTask()}><span className="stop-square" />Stop task</button>
                    ) : (
                      <button className="run-button" type="button" disabled={!command.trim()} onClick={() => void runTask()}><span>Run task</span><Glyph name="arrow" /></button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <aside className="inspector-column" aria-label="Runtime details">
              <section className="inspector-section engine-section">
                <div className="section-heading"><span className="section-icon"><Glyph name="desktop" /></span><span>Control surface</span></div>
                <div className="engine-title"><span className={`large-status-dot status-${engine.state}`} />{engine.state === "ready" ? "Windows desktop" : "Windows only"}</div>
                <p className="engine-copy">{engine.state === "ready" ? "Actions stay local. OpenUse uses UI Automation first, with screenshots only when the model asks." : engine.detail}</p>
                <div className="engine-rule" />
                <div className="engine-foot"><span>Protocol</span><strong>JSON-lines / stdio</strong></div>
              </section>
              <section className="inspector-section safety-section">
                <div className="section-heading"><span className="section-icon"><Glyph name="shield" /></span><span>Safety posture</span></div>
                <ul className="safety-list">
                  <li><Glyph name="check" /><span>Semantic UI before coordinates</span></li>
                  <li><Glyph name="check" /><span>App permissions on every control path</span></li>
                  <li><Glyph name="check" /><span>Stop cancels model and native work</span></li>
                </ul>
                <button className="text-button" type="button" disabled={isRunning} onClick={() => setSettingsOpen(true)}>Review permissions <Glyph name="arrow" /></button>
              </section>
              <section className="inspector-section model-section">
                <div className="section-heading"><span className="section-icon"><Glyph name="spark" /></span><span>Model capability</span></div>
                <div className="model-detail-name">{activeModel.label}</div>
                <div className="model-detail-id">{activeModel.id}</div>
                <div className={`model-compatibility ${modelCompatible ? "compatible" : "incompatible"}`}>{modelCompatible ? "Ready for Computer Use" : "Not compatible with Computer Use"}</div>
                <div className="capability-checks"><span className={activeModel.capabilities.toolCalling ? "" : "capability-missing"}><Glyph name={activeModel.capabilities.toolCalling ? "check" : "alert"} />Tool calling</span><span className={activeModel.capabilities.vision ? "" : "capability-missing"}><Glyph name={activeModel.capabilities.vision ? "check" : "alert"} />Vision</span></div>
              </section>
            </aside>
          </div>
        </div>
      </main>

      {permission && <PermissionDialog request={permission} onDecision={(decision) => {
        void runtimeApi.decidePermission(permission.id, decision);
        setPermission(undefined);
      }} onStop={() => {
        setPermission(undefined);
        void stopTask();
      }} />}
      {settingsOpen && <SettingsDialog
        settings={settings}
        apiKeyDraft={apiKeyDraft}
        onApiKeyChange={setApiKeyDraft}
        onClose={() => setSettingsOpen(false)}
        onSave={(modelId) => void saveSettings(modelId, apiKeyDraft)}
        onPermissionChange={(appName, level) => void updatePermission(appName, level)}
      />}
    </div>
  );
}

function handleRuntimeEvent(
  event: RuntimeEvent,
  setters: {
    setEntries: React.Dispatch<React.SetStateAction<TimelineEntry[]>>;
    setStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
    setStep: React.Dispatch<React.SetStateAction<number>>;
    setActionCount: React.Dispatch<React.SetStateAction<number>>;
    setPermission: React.Dispatch<React.SetStateAction<PermissionRequest | undefined>>;
    setEngine: React.Dispatch<React.SetStateAction<EngineStatus>>;
    setError: React.Dispatch<React.SetStateAction<string | undefined>>;
  },
) {
  switch (event.type) {
    case "task.started":
      setters.setStatus("running");
      setters.setEntries([{ kind: "user", id: `user-${event.taskId}`, command: event.command }]);
      break;
    case "agent.step":
      setters.setStep(event.step);
      setters.setActionCount(event.actionCount);
      break;
    case "action.started":
      setters.setEntries((current) => [...current, { kind: "action", action: event.action }]);
      break;
    case "permission.requested":
      setters.setPermission(event.request);
      break;
    case "permission.resolved":
    case "model.usage":
      break;
    case "action.completed":
      setters.setEntries((current) => current.map((entry) => entry.kind === "action" && entry.action.actionId === event.actionId
        ? { ...entry, action: { ...entry.action, status: "completed", durationMs: event.durationMs, detail: event.detail } }
        : entry));
      break;
    case "action.failed":
      setters.setEntries((current) => current.map((entry) => entry.kind === "action" && entry.action.actionId === event.actionId
        ? { ...entry, action: { ...entry.action, status: "failed", errorCode: event.code, errorMessage: event.message } }
        : entry));
      break;
    case "task.finished":
      setters.setStatus(event.status);
      if (event.status === "error") setters.setError(event.summary);
      break;
    case "engine.status":
      setters.setEngine(event.status);
      break;
  }
}

function EmptyActivity({ onStarter }: { onStarter(value: string): void }) {
  return <div className="empty-activity">
    <div className="empty-orbit" aria-hidden="true"><span className="orbit-core" /><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /></div>
    <div className="empty-title">Your computer, on request.</div>
    <p>Start with a small task. OpenUse will observe, act, and verify each step.</p>
    <div className="starter-list">
      {STARTER_COMMANDS.map((starter) => <button type="button" key={starter} onClick={() => onStarter(starter)}>{starter}<Glyph name="arrow" /></button>)}
    </div>
  </div>;
}

function UserEntry({ command }: { command: string }) {
  return <div className="timeline-entry user-entry"><div className="entry-avatar user-avatar">You</div><div className="entry-body"><div className="entry-label">User</div><div className="user-command">{command}</div></div></div>;
}

function ActionEntry({ action }: { action: TimelineAction }) {
  const failed = action.status === "failed";
  return <div className={`timeline-entry action-entry action-${action.status}`}>
    <div className={`entry-status ${failed ? "entry-status-failed" : action.status === "completed" ? "entry-status-done" : "entry-status-active"}`}>
      {failed ? <Glyph name="alert" /> : action.status === "completed" ? <Glyph name="check" /> : <span className="mini-spinner" />}
    </div>
    <div className="entry-body"><div className="action-line"><span>{action.summary}</span>{action.durationMs !== undefined && <time>{formatDuration(action.durationMs)}</time>}</div>{action.detail && <div className="entry-detail">{action.detail}</div>}{failed && <div className="entry-error">{action.errorMessage}</div>}</div>
  </div>;
}

function PermissionDialog({ request, onDecision, onStop }: { request: PermissionRequest; onDecision(decision: PermissionDecision): void; onStop(): void }) {
  const denyRef = useRef<HTMLButtonElement>(null);
  const persistentApprovalAllowed = request.risk === "read" || request.risk === "interaction";
  useEffect(() => {
    denyRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onStop(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onStop]);
  return <div className="modal-backdrop permission-backdrop" role="presentation">
    <div className="permission-dialog" role="alertdialog" aria-modal="true" aria-labelledby="permission-title" aria-describedby="permission-description">
      <div className="permission-icon"><Glyph name="shield" /></div>
      <div className="dialog-eyebrow">Permission required</div>
      <h2 id="permission-title">Allow OpenUse to control {request.appName}?</h2>
      <p id="permission-description">OpenUse wants to <strong>{request.actionSummary}</strong>. The runtime classified this as <span className="risk-label">{request.risk}</span>.</p>
      <div className="permission-reason"><span>Why you're seeing this</span><p>{request.reason}</p></div>
      <div className="dialog-actions">
        <button ref={denyRef} className="secondary-action" type="button" onClick={() => onDecision("deny")}>Deny</button>
        <button className="secondary-action" type="button" onClick={() => onDecision("allow-once")}>Allow once</button>
        {persistentApprovalAllowed && <button className="primary-action" type="button" onClick={() => onDecision("always-allow")}>Always allow</button>}
        <button className="stop-dialog-action" type="button" onClick={onStop}>Stop task</button>
      </div>
    </div>
  </div>;
}

function SettingsDialog({
  settings,
  apiKeyDraft,
  onApiKeyChange,
  onClose,
  onSave,
  onPermissionChange,
}: {
  settings: AppSettings;
  apiKeyDraft: string;
  onApiKeyChange(value: string): void;
  onClose(): void;
  onSave(modelId: string): void;
  onPermissionChange(appName: string, level: PermissionLevel, appIdentity?: string): void;
}) {
  const [modelId, setModelId] = useState(settings.modelId);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} ref={dialogRef}>
      <div className="dialog-topline"><div><div className="dialog-eyebrow">OpenUse configuration</div><h2 id="settings-title">Settings</h2></div><button className="close-button" type="button" aria-label="Close Settings" onClick={onClose}>×</button></div>
      <p className="settings-lede">Choose the model that reasons over your desktop. The key stays encrypted in Electron's main process.</p>
      <div className="settings-field"><label htmlFor="provider">AI provider</label><div className="field-readonly" id="provider">Vercel AI Gateway <span className="configured-tag">Connected by key</span></div></div>
      <div className="settings-field"><label htmlFor="settings-model">Model</label><div className="select-wrap"><select id="settings-model" value={modelId} onChange={(event) => setModelId(event.target.value)}>{MODEL_CATALOG.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}</select><Glyph name="chevron" /></div><div className="field-note">Computer Use requires tool calling and vision.</div></div>
      <div className="settings-field"><label htmlFor="gateway-key">API key</label><input id="gateway-key" type="password" autoComplete="off" value={apiKeyDraft} onChange={(event) => onApiKeyChange(event.target.value)} placeholder={settings.apiKeyConfigured ? "Key saved — enter a new key to replace it" : "Paste your AI_GATEWAY_API_KEY"} /><div className="field-note"><Glyph name="lock" /> Stored locally with OS-backed encryption. Never returned to the renderer.</div></div>
      <div className="settings-divider" />
      <div className="permissions-heading"><div><div className="dialog-eyebrow">Application permissions</div><h3>Who can OpenUse control?</h3></div><span className="permissions-count">{settings.permissions.length} rules</span></div>
      <div className="permission-list">{settings.permissions.map((record) => <div className="permission-row" key={record.appIdentity ?? record.appName}><div><div className="permission-app">{record.appName}</div><div className="permission-updated">{record.level === "ALLOW" ? "Control allowed" : record.level === "DENY" ? "Control blocked" : "Ask each time"}</div></div><div className="select-wrap permission-select"><select aria-label={`${record.appName} permission`} value={record.level} onChange={(event) => onPermissionChange(record.appName, event.target.value as PermissionLevel, record.appIdentity)}><option>ALLOW</option><option>ASK</option><option>DENY</option></select><Glyph name="chevron" /></div></div>)}</div>
      <div className="dialog-footer"><span className="settings-status">{settings.apiKeyConfigured ? <><span className="status-dot status-ready" />Gateway key configured</> : <><span className="status-dot status-offline" />Gateway key needed</>}</span><button className="primary-action" type="button" onClick={() => onSave(modelId)}>Save settings</button></div>
    </div>
  </div>;
}

function statusLabel(status: AgentStatus): string {
  return status === "idle" ? "Ready" : status === "running" ? "Working" : status === "completed" ? "Completed" : status === "stopped" ? "Stopped" : "Needs attention";
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function Glyph({ name }: { name: GlyphName }) {
  const paths: Record<GlyphName, string> = {
    activity: "M3 12h4l2-7 4 14 2-7h6",
    sliders: "M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4",
    chevron: "m7 10 5 5 5-5",
    arrow: "M4 12h15m-6-6 6 6-6 6",
    spark: "m12 3 1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-2.5L12 3Z",
    tool: "M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.4-2.4 1.8-2.9Z",
    desktop: "M4 5h16v11H4zM9 20h6M12 16v4",
    shield: "M12 3 20 6v5c0 5-3.4 8.2-8 10-4.6-1.8-8-5-8-10V6l8-3Z",
    check: "m5 12 4 4L19 6",
    alert: "M12 4 21 20H3L12 4Zm0 6v4m0 3h.01",
    lock: "M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3",
  };
  return <svg className="glyph" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

type GlyphName = "activity" | "sliders" | "chevron" | "arrow" | "spark" | "tool" | "desktop" | "shield" | "check" | "alert" | "lock";
