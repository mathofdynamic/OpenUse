# OpenUse v0.2 brand book

Status: `confirmed from v0.2 user product brief`
Version: `0.2.0`
Last updated: `2026-09-05`

## Company and product

- Company: OpenUse project (`confirmed` — user brief).
- Product: OpenUse, an AI-agnostic Computer Use runtime for macOS and Windows (`confirmed` — user brief).
- Thesis: OpenUse is a monochrome native computer-control utility whose single user-selected accent identifies agency and action. The application itself behaves like a translucent control layer over the user's computer rather than a conventional dashboard (`confirmed` — v0.2 brief).
- Product goal: let a user select an AI and give it bounded natural-language tasks to perform safely through semantic accessibility interaction, visual fallback, explicit permissions, and visible activity (`confirmed` — user brief).
- Differentiators: local-first execution, provider-neutral model boundary, semantic native control before coordinates, runtime-owned safety, live cost visibility, and a visible virtual Agent Cursor (`confirmed` — v0.2 brief and implementation).

## Audience and context

- Primary audience: technically capable Windows and macOS users who want AI assistance for bounded desktop tasks without unrestricted shell or filesystem access (`confirmed` — user brief).
- Secondary audience: contributors extending model providers and native controllers without splitting the product into OS-specific applications (`confirmed` — repository architecture and user brief).
- User jobs: choose a model, select supported reasoning, enter a task, understand what the agent is doing, approve or deny access, stop instantly, and inspect cost and outcome (`confirmed` — v0.2 brief).
- Environments: interactive Windows or macOS desktop session with an Electron application and native sidecar (`confirmed` — product scope).
- Language and direction: English LTR in the current product; arbitrary task text is not persisted in telemetry (`confirmed` — implementation and security requirements).
- Accessibility: WCAG 2.2 AA target, keyboard operation, visible focus, readable contrast, Escape handling, and reduced motion (`confirmed` — product brief and OCD configuration).

## Journeys and hierarchy

- Critical journeys: run a bounded task, inspect Activity, select a compatible model and reasoning level, approve/deny an app or risky action, Stop, and review task/lifetime spend (`confirmed` — v0.2 brief).
- Primary hierarchy: Current task → Activity → Task composer → Current model → Reasoning → Task spend → Computer state (`confirmed` — v0.2 brief).
- Secondary information: total spend, model details, safety explanation, and qualification/debug data (`confirmed` — v0.2 brief).
- Voice: calm, concise, operational, transparent, and never chain-of-thought exposing (`confirmed` — user brief).
- Claims to avoid: unrestricted control, guaranteed correctness, invisible automation, account-wide spend, or model-supplied risk authority (`confirmed` — safety and cost requirements).

## Visual system

- Personality: precise native utility; quiet, focused, controlled, and human-readable (`confirmed` — v0.2 brief).
- Color thesis: black, white, neutrals, and one user-selected primary color. Red and warning treatments are semantic safety states, not decorative brand colors (`confirmed` — v0.2 brief).
- Default primary: `#c8f36a`; the user can select a curated preset or validated custom HEX. The same primary drives action, focus, selection, progress, active agent state, and Agent Cursor (`confirmed` — implementation).
- Material thesis: OpenUse sits between the user, AI, and desktop. Native backdrop material provides desktop blur where possible; renderer material controls adjustable softness and opacity; text and icons remain crisp (`confirmed` — v0.2 brief and implementation).
- Anti-goals: generic dashboard, giant gradients, rainbow glass, excessive rounded cards, nested translucent panels, glowing borders everywhere, ornamental blur, and decorative brand colors (`confirmed` — v0.2 brief).
- Typography: system-first UI fonts with no remote font dependency; strong scale contrast and readable compact labels (`confirmed` — implementation constraint).
- Iconography: small original inline SVG line icons; no copied platform or competitor marks (`confirmed` — implementation).
- Motion: short transform-based transitions, cursor travel and action pulses only when they explain activity; all nonessential motion removed under `prefers-reduced-motion` (`confirmed` — v0.2 brief).

## Product surfaces

- Large windows use navigation, Activity, and Inspector.
- Medium windows compact navigation and narrow the Inspector without crushing Activity.
- Compact windows move navigation to the top and turn Inspector into a drawer/sheet.
- Narrow windows use one column, a sticky composer/footer, near-full-window Settings, and no permanent Inspector.
- Settings are organized into AI, Appearance, Usage, Permissions, and Advanced sections and remain keyboard-operable at short heights (`confirmed` — v0.2 brief and implementation).

## Technical and release constraints

- Shared Electron/React UI and agent across Windows and macOS; only native controller/material code is platform-specific (`confirmed` — user brief).
- Vercel AI Gateway is the default provider. A single custom OpenAI-compatible endpoint path supports advanced/local endpoints without duplicated provider systems (`confirmed` — v0.2 brief).
- Dynamic model metadata is validated and cached; pricing is current catalog data or explicitly unavailable; custom-provider cost is unknown unless trustworthy data exists (`confirmed` — v0.2 brief).
- Usage telemetry stores safe task metadata only, never commands, screenshots, passwords, accessibility trees, private UI text, or chain-of-thought (`confirmed` — v0.2 brief).
- Explicit exclusions: arbitrary shell/PowerShell, unrestricted filesystem, credential capture, automatic installation, hidden remote access, invisible background control, and permission bypass (`confirmed` — user brief).
- Windows package: x64 NSIS installer with packaged .NET sidecar. macOS arm64 DMG remains supported with local ad-hoc signing; public signing/notarization is separate (`confirmed` — implementation and release constraints).

## Evidence and open validation

| Statement | Label | Evidence | Status |
| --- | --- | --- | --- |
| Cross-platform product thesis and visual system | confirmed | v0.2 user brief and shared renderer tokens | implemented |
| Dynamic Gateway catalog and pricing source | confirmed | live `/v1/models` response and Zod parser | implemented; catalog refreshes at runtime |
| Windows native sidecar/package path | confirmed | Windows publish, tests, installer, installed process/resource inspection | verified |
| Real Windows model-backed task success | pending evidence | requires interactive native GUI plus Gateway key | not recorded in this automation session |
| macOS GUI qualification | pending evidence | requires interactive Mac session | not recorded here |

## Confirmation

- Approval scope: `full_brand_book_v0.2`
- Confirmed by: user v0.2 implementation brief
- Date: `2026-09-05`
- Confirmation evidence: this repository update and [docs/V0_2_DESIGN_SYSTEM.md](../../docs/V0_2_DESIGN_SYSTEM.md)
- Decision record: `.ocd-designer/decisions/README.md`
