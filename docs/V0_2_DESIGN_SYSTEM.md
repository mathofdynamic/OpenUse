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

The shared renderer supports English LTR and Persian RTL. English uses the
bundled SF Pro Display family supplied by the project; Persian uses the bundled
IRANYekanX family. Technical identifiers, model IDs, HEX values, and keyboard
shortcuts retain explicit LTR treatment inside either locale.

## Material

The BrowserWindow uses the platform compositor where it is reliable. macOS requests transparent under-window vibrancy. Windows uses a non-layered BrowserWindow with Electron Acrylic and `roundedCorners: true`, so the system backdrop and visible window boundary share the compositor's geometry. The renderer controls material opacity from 45% to 100% and keeps content crisp. Older Windows versions use a neutral dark surface; the blur slider remains a visual treatment control where the platform exposes a backdrop radius.

## Responsive states

| Width/height | Layout |
| --- | --- |
| `≥1200px` | rail and wide Activity surface |
| `900–1199px` | compact rail and Activity surface |
| `640–899px` | top navigation and full Activity surface |
| `420–639px` | single column with sticky composer/footer |
| `<420px` | slimmer controls and near-full-window Settings; Electron minimum is 480px wide |
| short height `≤640px` | independent timeline scrolling, reduced spacing, reachable composer and dialog actions |

Settings use sidebar sections on large windows and a single-column near-full-window surface on compact windows. Keyboard focus, Escape close, reduced motion, and visible approval actions are maintained in every state.

## Motion

Motion explains state: grouped entry, task progress, cursor travel, click pulses, and status transitions. Cursor animation uses transforms and short eased travel; it does not add a long delay to every action. `prefers-reduced-motion` removes nonessential travel/ripples while retaining state and target visibility.
