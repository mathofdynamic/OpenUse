# OCD Designer run plan

Stage: `BUILDING`

## Information architecture

One control surface: persistent header/status, central Activity timeline and composer, a compact Runtime inspector, a settings sheet, and an approval dialog. The first viewport answers three questions immediately: what model is selected, whether Windows control is available, and what OpenUse is doing now.

## Design direction

OpenUse uses a quiet, dark native utility visual language: charcoal ink surfaces, paper-bright type, a single warm signal-green accent, system typography, thin borders, and generous vertical rhythm. The central activity surface is the product, not a dashboard of cards. The timeline uses concise verbs and result marks; it never displays hidden reasoning or raw tool payloads.

## Type and spacing system

- System stack: `Segoe UI`, `Inter`, `Arial`, sans-serif.
- Display: 28–36px, 650 weight, tight leading.
- Body: 14px, 1.5 line-height.
- Labels: 11–12px, uppercase only for short metadata, tracking 0.1em.
- Spacing: 8px control rhythm with 16/24/32px grouping and 48px major section separation.
- Controls: minimum 40px height; visible focus ring in signal green.

## States and motion

The interface implements idle, ready, running, completed, stopped, error, unavailable, loading, validation, disabled, permission pending, and settings states. Transitions use opacity/transform only, are interruptible by Stop/Escape, and collapse under `prefers-reduced-motion`.

## Responsive strategy

Desktop keeps the runtime inspector beside Activity; tablet collapses it below the header; narrow widths move the rail above the timeline and keep the composer full width. The task controls remain reachable without horizontal scrolling.

## Implementation batches

1. Foundation: packages, Electron shell, secure settings, typed IPC, React control surface.
2. Controller: JSON-lines protocol, native Windows UI Automation sidecar, controller adapter, protocol tests.
3. Agent: Gateway provider, typed tools, manual step loop, cancellation and action limit.
4. Safety and vertical slice: permissions, approval dialog, timeline events, mock agent tests, Windows acceptance documentation.

The user's implementation brief is treated as the approval for this direction for this autonomous pass; unresolved market positioning remains explicitly provisional.
