# Decisions

Record user-approved design and scope decisions here.
# Decisions

- `2026-09-01`: Use the user's product brief as the confirmed Brand Book and design-direction input for this implementation pass so development can proceed without an approval pause. Revisit market positioning and final brand tokens before public launch.
- `2026-09-01`: Use a manual AI SDK loop rather than `ToolLoopAgent` because native action serialization, cancellation, approval waits, and the 30-call limit are runtime concerns that must remain explicit.
- `2026-09-01`: Keep the Windows controller in a .NET sidecar and expose only JSON-lines methods; do not depend on undocumented Codex native components.
- `2026-09-05`: Replace the v0.1 lime/charcoal visual source of truth with the v0.2 monochrome native-control thesis: one user-selected primary color, translucent window material, crisp structured surfaces, shared Windows/macOS UI, and a virtual click-through Agent Cursor.
- `2026-09-05`: Keep Gateway as the default and add one custom OpenAI-compatible endpoint path; do not duplicate provider implementations or make the agent provider-aware.
