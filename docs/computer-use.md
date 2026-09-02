# Computer Use runtime

## Platform-neutral controller

The agent and permission engine use one `ComputerController` contract. The Electron main process selects the native implementation from `process.platform`:

```text
ComputerController
├── MacComputerController  → Swift / macOS Accessibility, CoreGraphics, AppKit
└── WindowsComputerController → .NET 8 / UI Automation, Win32 capture and input
```

Both implementations use the same JSON-lines sidecar boundary and return the same normalized windows, elements, screenshots, errors, and interaction telemetry. The model never receives an OS handle or unrestricted system access.

## Observation priority

Each native controller follows this order:

1. Native accessibility information (macOS AXUIElement or Windows UI Automation).
2. Semantic element actions (AXPress/AXSetValue/AXRaise or InvokePattern/ValuePattern/SelectionItemPattern/TogglePattern), then element bounds.
3. A bounded screenshot when the model explicitly asks for visual feedback.
4. Raw coordinates only when the caller explicitly uses `computer_click` or semantic interaction falls back to element bounds.

`inspectWindow` returns a pruned tree: stable element ID, parent ID, role, subrole/class, bounded name/value, AutomationId where available, bounds, enabled/offscreen/focused state, and supported native actions/patterns. It does not send the raw accessibility tree or process executable paths to the model. Visible dialogs are retained in `listWindows`, so transient states such as TextEdit's Save dialog and Notepad's Save As dialog can be observed and verified. Element IDs are valid for the inspected UI state; if a control disappears or its fingerprint changes, the native side returns a stale/not-found error rather than reusing old bounds.

Window observations include process ID, process name, class name, and an application identity used by the permission engine. Windows identities use executable plus top-level class; macOS identities prefer `bundle:<bundle identifier>` and only use a process fallback when macOS does not expose a bundle ID.

Screen captures are reduced to a maximum width of 1440 pixels for model input, but retain `captureBounds`, `coordinateSystem`, and `scaleFactor`. Windows uses virtual-screen physical pixels after PerMonitorV2 initialization. macOS uses global desktop points for AX and CGEvent coordinates while the captured CGImage reports physical pixels; the mapping sent to the model converts image pixels back to the point-space capture bounds. This distinction is required on Retina displays and across monitor origins.

Every completed interaction reports the method that actually ran: `accessibility-native` for a native AX/UI Automation action or value set, `element-coordinate` when a found semantic element required its bounds, `vision-coordinate` when a coordinate action follows a current screenshot observation, `coordinate-input` for a direct coordinate action, and `keyboard-input` for bounded key input. The agent does not infer this from the model's tool name.

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

The runtime stops after 30 tool calls, on cancellation, or on a terminal failure. A stale/not-found semantic action causes one fresh-observation recovery opportunity; the same target failing again stops the task. It does not expose hidden chain-of-thought in the activity timeline; users see concise action summaries, approvals, outcomes, and errors.

## Native self-test and qualification diagnostics

The sidecar's `selfTest` command is internal to the runtime and is not an AI-facing tool. Windows checks UI Automation, window and monitor enumeration, one disposable screen capture, DPI detection, and a non-invasive input API call. macOS checks AX trust, Screen Recording trust, application/window/display enumeration, one disposable capture, Retina scale data, and CGEvent initialization. It returns `ok: false` when a capability or privacy grant is unavailable instead of claiming a pass. The platform preflight requires all capabilities before GUI qualification.

When `OPENUSE_QUALIFICATION_MODE=1`, the Electron app displays the same normalized elements sent to the model, native PID/protocol/heartbeat status, actual interaction method, window bounds, screenshot dimensions/origin/DPI/scale, and macOS permission state where relevant. The recorder persists only redacted metrics; screenshot pixels and UI element values are not written to the qualification report.
