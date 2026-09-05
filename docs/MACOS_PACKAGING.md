# OpenUse macOS packaging

The macOS package remains an arm64 Electron distributable with the Swift controller embedded in the application bundle. It uses the same v0.2 shared renderer and runtime as Windows.

## Build

On an arm64 Mac:

```bash
pnpm setup:macos
pnpm dist:macos
```

The build runs the shared Electron build, Swift release build, exact `app-logo/logo.png` icon generation, Electron Builder packaging, bundle checks, and the existing local ad-hoc signing hook. Artifacts are written to `dist/macos/` and are ignored by Git. The authoritative DMG filename is printed by the command and is expected to contain version `0.2.0` and `arm64`.

Expected bundle identity:

```text
Product name: OpenUse
Bundle ID:    com.openuse.app
Version:      0.2.0
Architecture: arm64
```

The embedded controller path is:

```text
OpenUse.app/Contents/MacOS/OpenUseMacController
```

The packaged main process resolves that helper from the app bundle. It does not rely on `native/macos/.build` after installation.

## Native material behavior

The BrowserWindow requests transparent rendering with macOS `vibrancy: "under-window"` and `visualEffectState: "active"`. The renderer's material layer still owns the adjustable blur treatment and background opacity, and a neutral CSS surface is used if vibrancy is unavailable. Content opacity is never used to make text or icons translucent.

## Install and permissions

Mount the generated DMG, copy OpenUse to Applications, eject it, and launch `/Applications/OpenUse.app`. Grant Accessibility and Screen Recording to the installed identity. A rebuild can change the local code identity and require permissions to be granted again.

## Signing limits

The current package uses local ad-hoc signing for development and qualification. It is not Developer ID signed, notarized, or ready for public Gatekeeper distribution. A future release must add deliberate hardened-runtime, entitlement, notarization, and stapling validation for both the parent app and embedded helper.
