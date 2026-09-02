# OpenUse macOS packaging

OpenUse uses `electron-builder` 26.15.3 for the local Apple Silicon package. The packaging path is intentionally separate from `pnpm dev`: the installed application is the qualification target and contains the Swift controller it needs at runtime.

## Build one arm64 distributable

From the repository root on an arm64 Mac:

```bash
pnpm setup:macos
pnpm dist:macos
```

`dist:macos` performs the following in one command:

1. builds the Electron main process and renderer;
2. builds `native/macos` in Swift release mode;
3. generates `OpenUse.icns` from the exact `app-logo/logo.png` source;
4. applies a local ad-hoc signature to the app and embedded executables;
5. packages an arm64 `OpenUse.app` and DMG;
6. audits the bundle ID, product name, signature, and embedded controller path.

The command fails before packaging if `app-logo/logo.png` is missing. It never substitutes a different image. Generated files are ignored by Git.

Artifacts are written below:

```text
dist/macos/
  OpenUse.app
  OpenUse-0.1.0-arm64.dmg
```

The exact DMG filename may include electron-builder's architecture suffix. The command prints the authoritative paths when it succeeds.

The builder itself stages its architecture output in the system temporary directory and copies only the final app and DMG back into `dist/macos`. This is deliberate: external volumes can create AppleDouble `._*` sidecars, and those must never be mistaken for an `app.asar` archive.

## Bundle identity and contents

The stable application identity is:

```text
Product name: OpenUse
Bundle ID:    com.openuse.app
Version:      0.1.0
Architecture: arm64
```

The Swift controller is copied into the app bundle as:

```text
OpenUse.app/Contents/MacOS/OpenUseMacController
```

In development, Electron resolves `native/macos/.build/release/OpenUseMacController`. In a packaged app it resolves the helper from `Contents/MacOS/OpenUseMacController` by resolving one level above `process.resourcesPath`; no repository-relative path is used after installation. The helper is placed in the standard macOS executable location so code-signing and privacy attribution can treat it as embedded executable code. The packaged process ignores `OPENUSE_NATIVE_ENGINE_PATH`, which is a development/test override only. The controller remains a child process on private JSON-lines stdin/stdout and is shut down when OpenUse exits.

## Icon

The only accepted source is:

```text
app-logo/logo.png
```

The build script uses macOS `sips` to preserve the artwork and transparency while producing the standard iconset sizes, then uses `iconutil` to create `apps/desktop/.build/macos/OpenUse.icns`. The generated ICNS is build output and is not committed.

## Install and launch the packaged app

Mount the generated DMG in Finder, drag **OpenUse** to the **Applications** shortcut, eject the DMG, and launch `/Applications/OpenUse.app`. Electron-builder supplies the standard Applications shortcut in the DMG. Or use these non-destructive command-line checks:

```bash
open dist/macos/OpenUse-0.1.0-arm64.dmg
open /Applications/OpenUse.app
```

Qualification must target `/Applications/OpenUse.app`, not the loose development controller. The default `pnpm qualify:macos` checks for that installed app. An explicit alternate bundle can be supplied with:

```bash
OPENUSE_QUALIFICATION_APP_PATH=/Applications/OpenUse.app pnpm qualify:macos
```

The development-only harness is explicit:

```bash
pnpm qualify:macos --development
```

## Signing state

The current local configuration sets `identity: null`, disables automatic certificate discovery, and applies an ad-hoc signature in the `afterPack` hook. This is enough for local Apple Silicon execution of the embedded helper, but it is not public-distribution signing and does not provide notarization or Gatekeeper trust. Do not claim distribution readiness from this build. Because ad-hoc signatures have no Developer ID team identity, rebuilding the app can require macOS privacy permissions to be granted again.

No custom entitlements are currently added. Accessibility and Screen Recording are macOS TCC permissions checked by the Swift controller; they are not granted by an Electron entitlement or a fake usage description. Future public releases should replace the local ad-hoc hook with deliberate Developer ID signing, hardened-runtime, entitlements, notarization, and stapling configuration after testing the helper and parent bundle together.

## Privacy permission identity

The packaged app must be launched from `/Applications/OpenUse.app` before granting permissions. Check both:

```text
System Settings → Privacy & Security → Accessibility
System Settings → Privacy & Security → Screen & System Audio Recording
```

The exact identity shown by the installed macOS build is a qualification result, not an assumption. OpenUse reports Accessibility and Screen Recording state in its first-run setup and provides buttons that open the corresponding System Settings panes. If macOS lists the embedded controller separately, grant the clearly identified OpenUse controller as instructed by the app and record the displayed name in `docs/macos-qualification.md`.

## Future release work

Before public distribution, configure and verify:

- Developer ID Application signing for the Electron app and embedded Swift helper;
- hardened runtime and only the entitlements actually required;
- notarization and stapling;
- signature verification after DMG installation;
- update and rollback behavior.

None of those steps are silently enabled by the local qualification package.
