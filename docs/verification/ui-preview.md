# OpenUse renderer preview evidence

Date: 2026-09-01
Environment: Vite renderer preview at `http://127.0.0.1:5173`

Observed states through the preview bridge:

- Initial control room renders the OpenUse brand, model selector, Activity surface, composer, runtime inspector, and disabled Windows-control state.
- Settings opens as an accessible dialog with provider/model/key fields and the seeded permission rules for Notepad, Calculator, Explorer, Chrome, and Password Manager.
- A starter command fills the real composer; the action control remains guarded when the desktop bridge or Gateway key is unavailable.
- At 640px wide the side rail is hidden, the layout becomes one column, and the inspector sections stack without horizontal overflow.

The preview deliberately has no Electron bridge. It reports the Windows engine as unavailable and rejects task execution, so this artifact is UI evidence only, not evidence that computer actions were performed.
