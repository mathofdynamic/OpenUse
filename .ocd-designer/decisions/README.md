# Decisions

Record user-approved design and scope decisions here.
# Decisions

- `2026-09-01`: Use the user's product brief as the confirmed Brand Book and design-direction input for this implementation pass so development can proceed without an approval pause. Revisit market positioning and final brand tokens before public launch.
- `2026-09-01`: Use a manual AI SDK loop rather than `ToolLoopAgent` because native action serialization, cancellation, approval waits, and the 30-call limit are runtime concerns that must remain explicit.
- `2026-09-01`: Keep the Windows controller in a .NET sidecar and expose only JSON-lines methods; do not depend on undocumented Codex native components.
