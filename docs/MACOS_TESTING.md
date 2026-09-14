# OpenUse macOS testing

macOS is a first-class OpenUse platform. It uses the same Electron/React UI, model catalog, reasoning, cost, usage, appearance, permission, and Agent Cursor features as Windows. Only the native controller and OS permission/material implementation differ.

## Requirements

- macOS 13 or newer, arm64 or x64.
- Node.js 20 or newer and pnpm 10.14.0.
- Swift 5.9 or newer from Xcode Command Line Tools.
- An interactive unlocked desktop session.
- A Vercel AI Gateway key.

## Setup and preflight

```bash
corepack enable
corepack prepare pnpm@10.14.0 --activate
pnpm setup:macos
pnpm verify:macos
```

`setup:macos` builds `native/macos/.build/release/OpenUseMacController`. `verify:macos` runs the shared checks, Swift build/tests, protocol smoke test, and the permission-aware native self-test. It must run on a Mac.

## Permissions and installed target

Build and install the v0.2 package with [MACOS_PACKAGING.md](MACOS_PACKAGING.md), then grant Accessibility and Screen Recording to the installed `/Applications/OpenUse.app`. Use OpenUse's **Recheck** control after granting permissions. Do not qualify a repository-relative helper and call it installed-app evidence.

## GUI qualification

```bash
pnpm qualify:macos
```

The harness runs the same three model-backed scenarios used on Windows: TextEdit typing, Calculator `37 × 19` with visible `703`, and TextEdit Save As, three times each. It also guides Stop/restart, permission decisions, vision fallback, Retina/DPI mapping, and multi-monitor checks. It never injects a click script or writes the file outside the UI.

No Windows run can establish macOS GUI qualification. The current macOS status is recorded separately in [macos-qualification.md](macos-qualification.md).

## Coordinate and cursor validation

macOS accessibility bounds and CGEvent input use global desktop points. CoreGraphics screenshots use physical pixels and include capture bounds and scale factor. Validate that the Agent Cursor uses the logical point target, follows semantic actions, remains click-through, and aligns on Retina and secondary displays.

## Responsive and appearance checks

Inspect the shared UI at 1440, 1100, 800, and 520px widths and a short-height window. Verify primary color, blur, opacity, cursor visibility, settings tabs, model picker, task spend, usage, keyboard focus, Escape handling, and reduced motion. Native vibrancy is an enhancement; the neutral translucent CSS material remains the fallback.
