import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import type { CursorInteraction, CursorTarget, QualificationBounds } from "@openuse/shared";
import { mapCursorTarget, virtualDisplayBounds, type OverlayDisplay } from "./cursor-geometry";
import { AGENT_CURSOR_WINDOW_POLICY } from "./cursor-overlay-policy";

interface OverlayState {
  visible: boolean;
  color: string;
  interaction: CursorInteraction;
  x?: number;
  y?: number;
  sequence: number;
}

interface CursorOverlayOptions {
  rendererDirectory: string;
  devServerUrl?: string;
}

export class CursorOverlayManager {
  private overlay: BrowserWindow | undefined;
  private hideTimer: NodeJS.Timeout | undefined;
  private enabled = true;
  private color = "#c8f36a";
  private sequence = 0;
  private overlayBounds: QualificationBounds = { x: 0, y: 0, width: 1, height: 1 };
  private displays: OverlayDisplay[] = [];
  private readonly refreshDisplays = (): void => {
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.refreshBounds();
  };

  constructor(private readonly options: CursorOverlayOptions) {}

  create(): void {
    if (this.overlay || (process.platform !== "win32" && process.platform !== "darwin")) return;
    this.refreshBounds();
    this.overlay = new BrowserWindow({
      x: this.overlayBounds.x,
      y: this.overlayBounds.y,
      width: this.overlayBounds.width,
      height: this.overlayBounds.height,
      show: AGENT_CURSOR_WINDOW_POLICY.show,
      frame: AGENT_CURSOR_WINDOW_POLICY.frame,
      transparent: AGENT_CURSOR_WINDOW_POLICY.transparent,
      resizable: AGENT_CURSOR_WINDOW_POLICY.resizable,
      movable: AGENT_CURSOR_WINDOW_POLICY.movable,
      minimizable: AGENT_CURSOR_WINDOW_POLICY.minimizable,
      maximizable: AGENT_CURSOR_WINDOW_POLICY.maximizable,
      closable: AGENT_CURSOR_WINDOW_POLICY.closable,
      skipTaskbar: AGENT_CURSOR_WINDOW_POLICY.skipTaskbar,
      focusable: AGENT_CURSOR_WINDOW_POLICY.focusable,
      hasShadow: AGENT_CURSOR_WINDOW_POLICY.hasShadow,
      webPreferences: {
        preload: join(__dirname, "overlay-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.overlay.setAlwaysOnTop(true, AGENT_CURSOR_WINDOW_POLICY.alwaysOnTopLevel);
    this.overlay.setIgnoreMouseEvents(AGENT_CURSOR_WINDOW_POLICY.ignoreMouseEvents, { forward: AGENT_CURSOR_WINDOW_POLICY.forwardMouseEvents });
    this.overlay.setFocusable(false);
    this.overlay.on("closed", () => { this.overlay = undefined; });
    this.overlay.webContents.once("did-finish-load", () => this.send({ visible: false, color: this.color, interaction: "waiting", sequence: this.sequence }));
    const devUrl = this.options.devServerUrl?.replace(/\/$/, "");
    if (devUrl) void this.overlay.loadURL(`${devUrl}/overlay.html`);
    else void this.overlay.loadFile(join(this.options.rendererDirectory, "overlay.html"));
    screen.on("display-added", this.refreshDisplays);
    screen.on("display-removed", this.refreshDisplays);
    screen.on("display-metrics-changed", this.refreshDisplays);
  }

  setAppearance(input: { color?: string; enabled?: boolean }): void {
    if (input.color) this.color = input.color;
    if (input.enabled !== undefined) this.enabled = input.enabled;
    if (!this.enabled) this.hide();
    else this.send({ visible: false, color: this.color, interaction: "waiting", sequence: this.sequence });
  }

  show(interaction: CursorInteraction, target?: CursorTarget): void {
    if (!this.enabled || !this.overlay || this.overlay.isDestroyed() || !target) return;
    const point = mapCursorTarget(target, this.displays, this.overlayBounds);
    if (!point) return;
    this.clearHideTimer();
    this.sequence += 1;
    this.send({ visible: true, color: this.color, interaction, x: point.x, y: point.y, sequence: this.sequence });
    if (!this.overlay.isVisible()) this.overlay.showInactive();
  }

  hide(): void {
    this.clearHideTimer();
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.send({ visible: false, color: this.color, interaction: "waiting", sequence: this.sequence });
    this.overlay.hide();
  }

  /**
   * Keep the final target visible long enough for the renderer's spring to
   * communicate the action, without delaying the runtime or native task.
   * Stop still calls hide() directly and therefore remains immediate.
   */
  hideAfterTask(delayMs = 420): void {
    this.clearHideTimer();
    if (!this.overlay || this.overlay.isDestroyed()) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      this.hide();
    }, Math.max(0, delayMs));
  }

  dispose(): void {
    this.clearHideTimer();
    screen.removeListener("display-added", this.refreshDisplays);
    screen.removeListener("display-removed", this.refreshDisplays);
    screen.removeListener("display-metrics-changed", this.refreshDisplays);
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.destroy();
    this.overlay = undefined;
  }

  private refreshBounds(): void {
    this.displays = screen.getAllDisplays().map((display, index) => ({
      index,
      bounds: { x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height },
      scaleFactor: display.scaleFactor,
    }));
    this.overlayBounds = virtualDisplayBounds(this.displays);
    if (this.overlay && !this.overlay.isDestroyed()) this.overlay.setBounds(this.overlayBounds);
  }

  private send(state: OverlayState): void {
    if (!this.overlay || this.overlay.isDestroyed() || this.overlay.webContents.isLoading()) return;
    this.overlay.webContents.send("openuse:overlay-state", state);
  }

  private clearHideTimer(): void {
    if (this.hideTimer === undefined) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }
}
