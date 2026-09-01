# Computer Use runtime

## Observation priority

The Windows sidecar follows this order:

1. Windows UI Automation and accessibility properties.
2. Semantic element actions (`InvokePattern`, `SelectionItemPattern`, `TogglePattern`, then element bounds).
3. A bounded screenshot when the model explicitly asks for visual feedback.
4. Raw coordinates only when the caller explicitly uses `computer_click` or semantic interaction falls back to element bounds.

`inspectWindow` returns a pruned tree: role, name, automation ID, bounds, enabled/offscreen state, and a bounded list of children. It does not send the raw accessibility tree or process executable paths to the model. Visible owned dialogs are retained in `listWindows`, so transient states such as Notepad's Save As dialog can be observed and verified.

## Tool protocol

The AI-facing tool names use provider-safe underscores while their product names remain `computer.*`:

| Product tool | AI tool | Purpose |
| --- | --- | --- |
| `computer.listApps` | `computer_list_apps` | List visible applications |
| `computer.listWindows` | `computer_list_windows` | List top-level windows |
| `computer.inspectWindow` | `computer_inspect_window` | Return a bounded accessibility tree |
| `computer.captureScreen` | `computer_capture_screen` | Capture one reduced screenshot |
| `computer.launchApp` | `computer_launch_app` | Launch a named application |
| `computer.focusWindow` | `computer_focus_window` | Bring a window to the foreground |
| `computer.click` | `computer_click` | Coordinate fallback |
| `computer.clickElement` | `computer_click_element` | Semantic click with fresh lookup |
| `computer.doubleClick` | `computer_double_click` | Coordinate double click |
| `computer.typeText` | `computer_type_text` | Type into the focused/target window |
| `computer.pressKey` | `computer_press_key` | Press one key or a safe key chord |
| `computer.scroll` | `computer_scroll` | Scroll the focused window |
| `computer.wait` | `computer_wait` | Wait for UI settling |
| `computer.finish` | `computer_finish` | Tell the runtime the task is complete |

Every input is validated by Zod before dispatch and by the native protocol before reaching Windows. Action results include a useful structured summary and, for window-targeted actions, a fresh post-action inspection when available.

## Closed loop

The agent calls the provider for one step, appends the provider's response messages, executes returned tools serially, appends each result, and repeats. It never plans a full macro in advance. The system prompt tells the model to inspect before acting, prefer semantics, verify changes, and stop after `computer_finish`.

The runtime stops after 30 tool calls, on cancellation, or on a terminal failure. It does not expose hidden chain-of-thought in the activity timeline; users see concise action summaries, approvals, outcomes, and errors.
