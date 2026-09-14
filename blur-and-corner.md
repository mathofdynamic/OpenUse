# Electron Windows blur and rounded-corner recipe

Reusable guidance for Electron applications that need all of the following at the same time:

- a frameless window with working drag, resize, minimize, maximize, and close controls;
- Windows-native rounded corners;
- visible desktop blur/material behind the application;
- crisp, fully opaque text and controls;
- no rectangular backdrop bleed, corner gaps, or mismatched inner/outer radii.

This is the pattern proven in OpenUse v0.2 on Windows. It is intentionally conservative: the operating system owns the outer window geometry and backdrop, while the web renderer owns only the application surfaces inside that window.

## The short answer

For Windows 11, use Electron's native window material and native corner support together:

```ts
const win = new BrowserWindow({
  frame: false,
  transparent: false,
  roundedCorners: true,
  // Leave thickFrame at its default: true.
  // Do not create a custom SetWindowRgn/setShape region.
  backgroundColor: "#00000000",
  webPreferences: {
    preload: join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

if (process.platform === "win32") {
  win.setBackgroundMaterial("acrylic");
}
```

Then keep the renderer's page, root, shell, and title bar transparent or semi-transparent, and apply a single modest inner radius:

```css
:root {
  --window-radius: 10px;
  --surface-alpha: 0.78;
  --background-blur: 18px;
}

html,
body,
#root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
  border-radius: var(--window-radius);
}

.app-window {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--window-radius);
  background: transparent;
  clip-path: inset(0 round var(--window-radius));
}

.material-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background: rgba(8, 8, 8, var(--surface-alpha));
  backdrop-filter: blur(var(--background-blur)) saturate(105%);
  -webkit-backdrop-filter: blur(var(--background-blur)) saturate(105%);
}
```

The important part is not any one CSS declaration. It is the ownership boundary:

```text
Windows DWM / Electron
    outer corners, native shadow, system backdrop, resize frame

Renderer / CSS
    inner surface alpha, borders, content layout, title-bar chrome
```

Do not give both layers authority over the native silhouette.

## Why the obvious approaches fail

### `backdrop-filter` alone is not desktop blur

CSS `backdrop-filter: blur(...)` blurs pixels behind an element in the renderer's compositing context. It is not a reliable way to sample and blur the Windows desktop behind an Electron window. It can be useful as a renderer fallback or as a softness treatment, but it should not be the only desktop-material implementation.

If the entire renderer is opaque, neither CSS backdrop filtering nor a native material behind it can be seen. At least the material host and the intended web surfaces must have controlled alpha.

### `transparent: true` plus Acrylic is a dangerous combination

An Electron transparent window uses a different Windows composition path. Combining it with a system Acrylic material can cause the material to be painted as a rectangular native layer while CSS clips the web content to rounded corners. The result is a square or rough halo outside the intended corners.

For the Windows native-material path, use:

```ts
transparent: false,
roundedCorners: true,
win.setBackgroundMaterial("acrylic");
```

Make the renderer surfaces transparent instead of making the native window a custom layered window.

### A custom `setShape()` or `SetWindowRgn()` is usually the wrong first fix

A custom region is normally calculated from the content rectangle. On Windows, a frameless resizable window can still have an invisible native resize frame. The content bounds and the actual native window bounds are therefore not always the same rectangle.

If the custom region is inset or sized from the wrong coordinate space, it can create:

- a visible strip of native material;
- a gap between the inner content and outer backdrop;
- corners that look more rounded on one layer than another;
- broken resize hit testing;
- a shadow or backdrop that does not follow the visible surface.

The reliable default is to remove the custom region and let Electron/DWM apply the native rounded window geometry.

CSS `clip-path` is acceptable for clipping the renderer's inner paint. It is not a replacement for the native window silhouette.

### `thickFrame: false` is not a corner fix

Electron's `thickFrame` maps to the Windows `WS_THICKFRAME` style. Setting it to `false` may appear to remove an edge, but it also removes the native shadow and window animations and disables resizing by dragging the window edges.

Leave it at its default value of `true` unless the product deliberately implements all native resize behavior itself.

### Matching large radii creates a seam

The outer Windows radius is system-defined. The renderer radius is CSS-defined. They are different coordinate/compositing layers and are not guaranteed to produce the same anti-aliased curve.

Use a small, consistent inner radius rather than trying to reproduce Windows' exact radius. In OpenUse, `10px` gives the web surface a slightly tighter curve than the native outer corner and prevents a dark or transparent seam.

Do not let different children paint square backgrounds into the rounded root. The root, application shell, title bar, material layer, and any full-bleed surface must either inherit the geometry or be clipped by the parent.

## The Windows implementation

### 1. Configure the BrowserWindow once

The main-process window should be configured before the page is loaded:

```ts
const win = new BrowserWindow({
  width: 1320,
  height: 860,
  minWidth: 480,
  minHeight: 560,
  frame: false,
  autoHideMenuBar: process.platform === "win32",

  // Keep a native, non-layered Windows window for DWM material.
  transparent: false,
  backgroundColor: "#00000000",
  roundedCorners: true,

  // Do not set thickFrame: false. The default preserves resizing/shadow.
  webPreferences: {
    preload: join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
```

The `backgroundColor` value prevents an unstyled startup flash in the application. The renderer still needs transparent backgrounds where the system material must remain visible. Do not replace the entire renderer with a fully opaque `#000` or `#fff` background.

### 2. Apply the system material on Windows

Use a small, guarded main-process abstraction:

```ts
function applyWindowsBackdropMaterial(
  win: BrowserWindow,
  blurEnabled: boolean,
): void {
  if (process.platform !== "win32" || win.isDestroyed()) return;

  try {
    win.setBackgroundMaterial(blurEnabled ? "acrylic" : "none");
  } catch {
    // Older Windows/Electron composition falls back to renderer surfaces.
  }
}
```

Call it:

1. immediately after creating the main window;
2. after appearance settings have been loaded;
3. whenever the user changes the blur setting.

Do not poll the system or recreate the window for every slider movement. `setBackgroundMaterial` is the controlled runtime update path.

`setBackgroundMaterial` is supported on Windows 11 22H2 and later. On unsupported systems, keep the app usable with a neutral, translucent renderer surface. Do not pretend that the fallback is the same as native desktop blur.

### 3. Keep the renderer transparent at the correct levels

Use alpha on background surfaces, not opacity on a parent that contains text:

```css
/* Good: only the material surface is translucent. */
.material-layer {
  background: rgba(8, 8, 8, 0.78);
}

/* Bad: text, icons, and controls inherit this transparency. */
.app-window {
  opacity: 0.78;
}
```

A useful layering model is:

```text
native DWM Acrylic
  -> transparent renderer page
    -> one full-window material layer with controlled rgba alpha
      -> crisp application content
```

Avoid putting an opaque background on `html`, `body`, `#root`, or the main shell if the native material needs to show through. Avoid turning every card into a translucent glass panel. The window can be translucent while the UI remains structured and mostly solid.

### 4. Make the inner geometry coherent

Apply the same inner radius to the page root and the outer renderer shell:

```css
:root {
  --window-radius: 10px;
}

html,
body,
#root,
.app-window {
  border-radius: var(--window-radius);
}

.app-window,
.app-shell {
  overflow: hidden;
}

.window-titlebar {
  border-radius: var(--window-radius) var(--window-radius) 0 0;
  -webkit-app-region: drag;
}

.window-controls,
.window-control,
button,
input,
select,
textarea {
  -webkit-app-region: no-drag;
}

.app-shell {
  border-radius: 0 0 var(--window-radius) var(--window-radius);
}
```

The title-bar content must be drag-enabled, while buttons and controls must explicitly opt out of dragging. This preserves window movement and prevents controls from becoming unclickable.

Keep `box-sizing: border-box` globally. Otherwise borders can increase the painted size of an inner surface and make the corner alignment look off by one or two pixels.

### 5. Avoid rectangular child paint

Common sources of a square corner inside an otherwise rounded window:

- a title bar with a separate opaque background and no top radius;
- a full-height sidebar with an opaque background reaching the bottom corner;
- a material layer whose radius is different from the shell;
- a modal or popup rendered outside the clipped root;
- a loading/error state that replaces the normal shell with a square element;
- a `body` background left at the browser default;
- a border drawn on one element and a background drawn on a different-sized element.

Use one full-window clipping owner and let child surfaces inherit or stay transparent. Inspect all states, not only the idle screen.

## Acrylic versus Mica

Electron exposes these Windows system materials through `setBackgroundMaterial`:

| Material | Visual behavior | Choose it when |
| --- | --- | --- |
| `none` | No system backdrop | Blur is disabled or native material is unavailable |
| `mica` | More opaque, wallpaper/theme-aware foundation material | The window should feel like a stable Windows 11 app surface, close to Settings |
| `acrylic` | More visibly frosted and translucent | The product needs the desktop to read through the window |
| `tabbed` | Material intended for tabbed title-bar treatment | The app has a tabbed Windows title-bar model |
| `auto` | DWM chooses | The app intentionally delegates the choice to Windows |

OpenUse uses `acrylic` because its product concept is a translucent control layer over the desktop. A long-lived conventional document app may be better served by `mica`.

Windows' own guidance generally positions Mica as a performant foundation material and Acrylic as a more transient frosted material. Electron exposes both, but the visual and performance trade-off still matters. Test the selected material on the target Windows versions and GPU configurations.

## Blur and opacity controls

Electron's `setBackgroundMaterial` selects a system material; it does not provide an arbitrary Windows blur-radius slider. Do not claim that a CSS `18px` value changes the DWM Acrylic radius.

Use two distinct controls:

```text
Background blur
  0 => setBackgroundMaterial("none")
  >0 => use the chosen native material, with CSS softness as a fallback/treatment

Background opacity
  changes rgba alpha on the renderer material layer
  never changes opacity on the content parent
```

Example:

```ts
const surfaceAlpha = clamp(opacity, 0.45, 1);
const rendererBlur = clamp(blur, 0, 40);

document.documentElement.style.setProperty(
  "--surface-alpha",
  String(surfaceAlpha),
);
document.documentElement.style.setProperty(
  "--background-blur",
  `${rendererBlur}px`,
);

applyWindowsBackdropMaterial(win, rendererBlur > 0);
```

When the opacity is `1`, the surface is intentionally opaque and desktop blur may become visually imperceptible. That is expected. The text must remain fully crisp at every setting.

## macOS equivalent

Keep the same React/CSS surface model and use macOS vibrancy only in the main process:

```ts
const win = new BrowserWindow({
  frame: false,
  transparent: true,
  ...(process.platform === "darwin"
    ? {
        vibrancy: "under-window",
        visualEffectState: "active",
      }
    : {}),
});
```

The renderer should remain transparent where the vibrancy material needs to show through. Use the same opacity tokens and inner geometry on both platforms. The exact native material is platform-specific; the product surface, design tokens, and behavior are not.

Do not use Windows-only React branches for appearance. Keep platform differences in the BrowserWindow configuration and any thin native integration layer.

## What OpenUse changed

The final OpenUse implementation is in:

- `apps/desktop/src/main/index.ts`
  - `frame: false`;
  - `transparent: false` on Windows;
  - `roundedCorners: true`;
  - default `thickFrame: true`;
  - guarded `setBackgroundMaterial("acrylic")` / `"none"`;
  - macOS `transparent: true` with `vibrancy: "under-window"` and active visual state.
- `apps/desktop/src/renderer/styles.css`
  - transparent page/root backgrounds;
  - `overflow: hidden` on the renderer shell;
  - one modest `--window-radius` value;
  - controlled alpha on the material layer;
  - no custom native window region.

The crucial correction was removing the custom native shape. It was trying to solve an operating-system window problem from the renderer/content geometry and caused the native material and visible content to disagree at the edges. Electron 43's native `roundedCorners` option and the Windows DWM material now provide the outer silhouette.

## Copy/paste prompt for another coding agent

Use this when fixing the same problem in another Electron application:

```text
Fix the Electron Windows window using native composition.

1. Use a frameless BrowserWindow with:
   frame: false
   transparent: false on Windows
   roundedCorners: true
   leave thickFrame at its default true

2. On Windows 11, call:
   win.setBackgroundMaterial("acrylic")
   or "none" when blur is disabled.
   Guard this call and provide a neutral fallback for unsupported systems.

3. Do not use setShape(), SetWindowRgn(), a custom HRGN, or any renderer-sized
   native region as the default solution. The Windows invisible resize frame
   must remain owned by Electron/DWM.

4. Keep html, body, #root, and the main renderer shell transparent where the
   native material needs to show through. Apply opacity with rgba() only to
   the background/material surface. Never apply opacity to a parent containing
   text or controls.

5. Give html/body/#root/app-shell/titlebar one consistent modest inner radius,
   normally about 8-10px. The inner CSS radius should be slightly tighter than
   the OS-owned outer radius. Add overflow:hidden and box-sizing:border-box.
   Do not let a child paint an opaque square into a corner.

6. Keep the custom title bar draggable with -webkit-app-region: drag and mark
   buttons/inputs as no-drag.

7. Verify all four corners after launch, resize, maximize/restore, appearance
   changes, loading, empty, error, and dialog states. Test 100%, 125%, and 150%
   Windows scaling. Confirm native edge resize still works and there is no
   rectangular Acrylic bleed or inner gap.

8. For macOS, keep the shared renderer and use a main-process conditional:
   transparent: true, vibrancy: "under-window",
   visualEffectState: "active".

Do not fix a native corner/material mismatch by stacking more CSS radii or by
making the entire window opacity lower. First restore the ownership boundary:
Windows/DWM owns the outer window; CSS owns the inner web surface.
```

## Validation checklist

### Window geometry

- [ ] All four outer corners are rounded by the OS.
- [ ] There is no square Acrylic rectangle outside the corners.
- [ ] There is no visible gap between the native edge and the renderer surface.
- [ ] The inner radius is consistent and slightly tighter than the native radius.
- [ ] The title bar, shell, loading state, error state, and dialogs share the same clipping model.
- [ ] The window can be moved from the drag region.
- [ ] Minimize, maximize/restore, and close work.
- [ ] Edge and corner resizing still work.
- [ ] `thickFrame` has not been disabled to hide a symptom.

### Material behavior

- [ ] Acrylic or Mica is applied from the main process, not only from CSS.
- [ ] The desktop remains visible through the intended background surfaces.
- [ ] Text, icons, inputs, and buttons remain crisp at every opacity setting.
- [ ] Blur `0` disables the system material cleanly.
- [ ] Unsupported Windows versions have a neutral fallback.
- [ ] The app does not constantly recreate the BrowserWindow while the user changes settings.
- [ ] Idle CPU/GPU usage remains reasonable.

### Scaling and states

- [ ] 100% DPI is aligned.
- [ ] 125% or 150% DPI is aligned.
- [ ] The window remains aligned after resizing.
- [ ] Maximize and restore do not leave a stale radius or material strip.
- [ ] The appearance setting updates without a needless restart.
- [ ] Modal windows and popups do not escape the intended clipping boundary.

## Official references

- [Electron `BaseWindowConstructorOptions`](https://www.electronjs.org/docs/latest/api/structures/base-window-options)
  - `roundedCorners`, `thickFrame`, `transparent`, `vibrancy`, and `backgroundMaterial`.
- [Electron `BrowserWindow`](https://www.electronjs.org/docs/latest/api/browser-window)
  - BrowserWindow creation and native window behavior.
- [Electron `setBackgroundMaterial`](https://www.electronjs.org/docs/latest/api/browser-window#setbackgroundmaterial-material-windows)
  - Windows system-material values and support notes.
- [Electron corner smoothing](https://www.electronjs.org/docs/latest/api/corner-smoothing-css)
  - Optional renderer corner smoothing. It does not replace native window corners.
- [Microsoft: System backdrops](https://learn.microsoft.com/en-us/windows/apps/develop/ui/system-backdrops)
  - Mica and Acrylic design guidance.
- [Microsoft: DWM window corner preference](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_window_corner_preference)
  - The native Windows corner preference model.

## Final rule

Use one owner per responsibility:

```text
Electron/DWM: native outer window, native corner, native material, resize frame
CSS/renderer: inner clipping, surface alpha, borders, typography, layout
```

When those responsibilities are mixed, the usual result is a rectangular bleed, a dark strip, a seam, or a broken resize frame. When they are separated, rounded corners and desktop blur can coexist without fighting each other.
