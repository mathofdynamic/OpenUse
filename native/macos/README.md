# OpenUse macOS controller

`OpenUseMacController` is a local JSON-lines sidecar for the Electron main process. It has no listening socket and exposes only the methods in `packages/protocol`.

The implementation uses:

- `ApplicationServices` / `AXUIElement` for the normalized accessibility tree, stable state-scoped element handles, `AXPress`, `AXConfirm`, `AXSetValue`, `AXRaise`, and related native actions.
- `AppKit` / `NSWorkspace` / `NSRunningApplication` for validated application launch, identity, activation, and bundle metadata.
- `CoreGraphics` for display/window enumeration, global point-space bounds, physical-pixel screen captures, and CGEvent input fallback.
- `ImageIO` for bounded PNG encoding and `UniformTypeIdentifiers` for the PNG type.

Accessibility and Screen Recording are checked with `AXIsProcessTrusted()` and `CGPreflightScreenCaptureAccess()`. The sidecar never requests or bypasses those grants, moves the pointer, captures pixels, or changes applications during `selfTest`.

Build and protocol-test it from the repository root:

```bash
pnpm native:build:macos
pnpm native:test:macos
pnpm --filter @openuse/desktop test:macos
```

`native:test:macos` is a dependency-free Swift assertion executable because the Command Line Tools environment does not guarantee XCTest modules. `test:macos` exercises the actual sidecar process boundary, malformed/unknown requests, enumeration, invalid windows, cancellation, reuse, and graceful shutdown. GUI actions are intentionally not part of the automated smoke test.
