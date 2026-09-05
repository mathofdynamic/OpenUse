# OpenUse v0.2 design system

## Thesis

OpenUse is a monochrome native computer-control utility whose single user-selected accent identifies agency and action. The application behaves like a translucent control layer between the user, AI, and desktop rather than a conventional dashboard.

## Visual rules

- Black, white, neutral surfaces, and one selected primary color.
- Functional danger/error red and warning treatment are semantic states, not decorative brand accents.
- Strong hierarchy, restrained borders, large clean surfaces, and precise typography.
- No rainbow accents, giant gradients, nested glass cards, glowing borders everywhere, or ornamental blur.
- The window material may be translucent; content remains opaque and crisp.

## Tokens

The renderer defines tokens for `--background`, `--surface`, `--surface-raised`, `--text-primary`, `--text-secondary`, `--border`, `--primary`, `--primary-hover`, `--primary-muted`, and semantic status colors. The default primary is `#c8f36a`. Presets and custom HEX input update the same token set immediately.

Primary foreground is selected from contrast against the user color. The primary is used for active navigation, primary actions, focus, selected model/reasoning controls, progress, active-agent state, and Agent Cursor geometry/pulses.

## Material

The BrowserWindow is transparent where the platform supports it. macOS requests Electron under-window vibrancy; Windows requests Acrylic through the current Electron API when available. The CSS material layer applies `backdrop-filter` blur and an adjustable neutral background alpha. Blur is configurable from 0 to 40px-equivalent and opacity from 45% to 100%. The fallback is a neutral translucent surface without requiring native composition.

## Responsive states

| Width/height | Layout |
| --- | --- |
| `≥1200px` | rail, wide Activity surface, Inspector |
| `900–1199px` | compact rail, Activity, narrower Inspector |
| `640–899px` | top navigation, full Activity, Inspector drawer/sheet |
| `420–639px` | single column, sticky composer/footer, no permanent Inspector |
| `<420px` | slimmer controls and near-full-window Settings; Electron minimum is 480px wide |
| short height `≤640px` | independent timeline scrolling, reduced spacing, reachable composer and dialog actions |

Settings use sidebar sections on large windows and a single-column near-full-window surface on compact windows. Keyboard focus, Escape close, reduced motion, and visible approval actions are maintained in every state.

## Motion

Motion explains state: grouped entry, task progress, cursor travel, click pulses, and status transitions. Cursor animation uses transforms and short eased travel; it does not add a long delay to every action. `prefers-reduced-motion` removes nonessential travel/ripples while retaining state and target visibility.
