# Brand Book

Status: `confirmed from user product brief`
Version: `0.1.0`
Last updated: `2026-09-01`

## Company and product

- Company: OpenUse project (`confirmed` — user brief).
- Product: OpenUse, an AI-agnostic Computer Use runtime for Windows (`confirmed` — user brief).
- Business goal: let a user direct a selected AI model to inspect and operate a Windows PC through a controlled, auditable tool layer (`confirmed` — user brief).
- Positioning and differentiators: local-first execution, provider-agnostic model boundary, semantic Windows UI Automation before screenshots/coordinates, and runtime-owned permissions (`confirmed` — user brief).
- Competitors or alternatives: general AI desktop agents and custom screenshot/mouse bots (`inferred` — category framing from user brief; not a claim of market research).

## Audience and context

- Primary audience: technically capable Windows users who want an AI to complete bounded desktop tasks without granting unrestricted shell or filesystem access (`confirmed` — user brief).
- Secondary audiences: open-source contributors and developers adding model providers or OS controllers (`confirmed` — repository structure and architecture requirements).
- User jobs: choose a model, enter a command, understand what the agent is doing, approve sensitive control, stop instantly, and verify completion (`confirmed` — user brief).
- Devices and environments: Windows desktop with an interactive user session; Electron desktop application (`confirmed` — MVP platform).
- Language, locale, and direction: English, LTR for MVP; text inputs must preserve arbitrary user content without exposing it in logs (`confirmed` — brief plus security requirements).
- Accessibility needs: WCAG 2.2 AA target, keyboard-operable composer/settings/approval dialog, visible focus, and reduced-motion behavior (`confirmed` — brief and default OCD target).

## Journeys and content

- Critical journeys: run a Notepad typing task; operate Calculator and verify the visible result; save a Notepad file through the UI; configure the Gateway key/model; approve or deny an application/action (`confirmed` — user brief).
- Primary action per journey: `Run`, `Stop`, `Allow Once`/`Always Allow`/`Deny`, and `Save settings` (`confirmed` — UI requirements).
- Success measures: the model calls typed tools incrementally, the native engine changes the actual Windows UI, the resulting state is inspected, and the timeline reports completion or a clear error (`confirmed` — user brief).
- Content hierarchy: current task and activity first; composer always available; runtime/model/safety status visible but secondary; settings and permissions discoverable without dominating the task surface (`confirmed` — UI requirements).
- Voice and vocabulary: calm, concise, operational, transparent; say what OpenUse is doing without exposing chain-of-thought (`confirmed` — user brief).
- Claims or words to avoid: do not imply unrestricted control, guaranteed correctness, invisible automation, or that the AI's risk label is authoritative (`confirmed` — security requirements).

## Visual system

- Brand personality: professional native utility; focused, precise, quiet, and human-controlled (`confirmed` — user brief).
- Visual principles: strong typography, low density, clear state signaling, generous spacing, dark charcoal foundation, warm signal accent, restrained borders, and purposeful motion (`confirmed` — UI requirements).
- Anti-goals: generic admin dashboard, giant gradients, cheap glassmorphism, card-everything layouts, raw chain-of-thought, and unnecessary decoration (`confirmed` — user brief).
- Approved colors: implementation tokens use ink `#0d0f10`, surface `#151819`, surface raised `#1d2222`, paper `#f0f1e8`, muted `#929a92`, and signal `#c8f36a`; these are provisional product tokens derived from the brief (`confirmed` — implementation direction).
- Typography and font files: system-first `Segoe UI`, with `Inter`/`Arial` fallback for cross-platform development; no remote font dependency (`confirmed` — technical constraint).
- Iconography: small original inline SVG line icons; no copied brand marks (`confirmed` — implementation direction).
- Imagery and asset rules: no decorative imagery required; model screenshots are transient tool data and not rendered into analytics or logs (`confirmed` — security requirements).
- Motion posture: subtle state transitions and grouped entrance only where they clarify state; all nonessential motion removed under `prefers-reduced-motion` (`confirmed` — user brief and OCD protocol).

## Technical and release constraints

- Supported browsers and viewports: Electron Chromium; responsive desktop, tablet, and narrow development widths (`confirmed` — stack and UI requirements).
- Performance target: renderer should remain responsive while model/native work runs in main; no continuous screen stream (`confirmed` — brief).
- Public/private indexing policy: private desktop app; discoverability is not applicable (`confirmed` — product type).
- Existing design system or component constraints: clean independent monorepo; React, TypeScript, Vite, Electron, pnpm; avoid copying T3 UI/branding (`confirmed` — brief).
- In-scope routes: one desktop control surface plus settings/permission surfaces (`confirmed` — MVP scope).
- Explicit exclusions: macOS/Linux control, remote control, network server, browser extension, shell/PowerShell, arbitrary filesystem, credentials, installation, schedules, voice, multiple agents, MCP server, and cloud accounts (`confirmed` — user brief).
- Acceptance criteria: TypeScript app launches; typed tools validate; agent loop is incremental/cancellable/30-step bounded; Windows sidecar implements observation/action protocol; permissions fail closed; Notepad/Calculator/Notepad Save scenarios work on Windows (`confirmed` — user brief).

## Evidence and unresolved assumptions

| Statement | Label | Source/evidence | Needs confirmation? |
|---|---|---|---|
| Product and technical requirements above | confirmed | User's implementation brief on 2026-09-01 | No for this implementation pass |
| Competitor/category framing | inferred | Product description only | Yes for future positioning work |
| Signal color tokens | confirmed | User's visual constraints translated into implementation tokens | No for MVP, revisit with brand assets |
| AI Gateway model capability metadata | unknown until provider catalog integration | Model registry in `packages/ai` | Yes before supporting custom models |

## Confirmation

- Approval scope: `full_brand_book`
- Confirmed by: user product brief, interpreted as implementation approval for this pass
- Date: `2026-09-01`
- Confirmation evidence ID: `E-0001` (durable project evidence recorded after this brief)
- Decision record: `.ocd-designer/decisions/README.md`

The full brief is the source of truth for this first implementation pass. Future brand changes should create a new version and invalidate dependent visual evidence.
