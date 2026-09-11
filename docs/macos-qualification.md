# macOS qualification record

## v0.2 status

**NOT MACOS-QUALIFIED FROM THIS WINDOWS PASS.**

The v0.2 code retains the shared UI/runtime and Swift protocol compatibility, but this Windows machine cannot execute macOS Accessibility, CoreGraphics, permission, packaging, or GUI tests. Do not convert Windows build evidence into a macOS GUI result.

## Required Mac evidence

Run `pnpm verify:macos`, build/install with `pnpm dist:macos`, and then run `pnpm qualify:macos` against `/Applications/OpenUse.app`. Record the generated scenario and manual-check results in the ignored `.openuse/qualification/` directory and summarize them here only after a real Mac run.

The record must include:

- TextEdit typing 3/3;
- Calculator 3/3 with visible `703`;
- TextEdit Save As 3/3;
- Stop/restart and permission matrix;
- actual Gateway model and cost evidence;
- Agent Cursor semantic and coordinate alignment;
- Retina/DPI and vision fallback evidence;
- multi-monitor result or `NOT TESTED — single-monitor machine`.

Packaging, native protocol, and source compatibility are necessary but are not GUI qualification.
