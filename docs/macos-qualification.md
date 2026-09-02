# macOS qualification record

## Current status

**NOT QUALIFIED — GUI qualification has not yet passed.**

This record is intentionally conservative. The current development host is macOS 26.0.1 arm64. The Swift controller builds and the protocol smoke test passes, but the native self-test last reported Accessibility and Screen Recording as denied. Therefore the three real AI scenarios have not been counted and OpenUse is not called macOS-qualified.

## Preflight evidence at implementation time

```text
macOS             26.0.1
Architecture      arm64
Node              24.18.0
pnpm              10.14.0
Swift             6.2
Monitor count     1
Display bounds    2560 × 1440 points
Scale factor      1× reported by CoreGraphics on this display
Accessibility     denied
Screen Recording   denied
```

Passing checks:

- Swift release build: PASS.
- Native protocol assertions: PASS.
- macOS sidecar JSON-lines smoke: PASS for malformed input, unknown method, enumeration response, invalid window handling, wait, cancellation, reuse, and graceful shutdown.
- TypeScript lint, typecheck, unit tests, and Electron production build: PASS.

Blocked checks:

- Native self-test with required grants: NOT PASS until Accessibility and Screen Recording are granted.
- TextEdit 3/3: NOT RUN.
- Calculator 3/3: NOT RUN.
- TextEdit Save As 3/3: NOT RUN.
- Stop, application permission, Retina fallback, vision fallback, and multi-monitor GUI checks: NOT RUN.

Run `pnpm qualify:macos` after the grants are approved. That command creates the authoritative timestamped `results.json` and `report.md` under `.openuse/qualification/`; update this summary only from those real results.
