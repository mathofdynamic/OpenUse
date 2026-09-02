# OpenUse design direction confirmation

Date: 2026-09-01
Scope: design_direction_and_plan

The first implementation uses one persistent control surface: a compact status header, central Activity timeline and composer, runtime/safety/model inspector, settings sheet, and permission dialog. The first viewport prioritizes the active model, native controller status, current task, and the next safe action.

The interface uses system-first typography, 8px control rhythm, 16/24/32px grouping, 48px major separation, minimum 40px controls, visible signal-green focus, and concise operational verbs. It implements idle, ready, running, completed, stopped, error, unavailable, disabled, permission-pending, and settings states. The inspector collapses below Activity at tablet widths; narrow widths hide the rail and keep the composer full width.

The runtime model is intentionally reflected in the UI: no raw tool payloads or hidden reasoning, a persistent Stop path, explicit permission choices, capability warnings, and an unavailable state when the Windows bridge is not present.
