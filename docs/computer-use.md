# Computer Use runtime

## One controller contract

The agent and permission engine use one `ComputerController` contract:

```text
ComputerController
├── MacComputerController     → Swift Accessibility/CoreGraphics/AppKit
└── WindowsComputerController → .NET UI Automation/Win32
```

The model does not receive OS handles, raw accessibility trees, unrestricted input APIs, or a filesystem primitive. Both controllers return normalized windows, bounded elements, screenshots, errors, and interaction telemetry over the same JSON-lines boundary.

## Observation and action priority

1. Inspect native accessibility information.
2. Prefer semantic actions such as AXPress, AXSetValue, InvokePattern, ValuePattern, SelectionItemPattern, and TogglePattern.
3. Use the fresh element bounds when a semantic target must fall back to an element-coordinate action.
4. Ask for one bounded screenshot when visual reasoning is required.
5. Use screenshot-derived coordinates only against that current observation.

Element IDs are state-bound. If a target disappears or its fingerprint changes, the native sidecar returns a stale/not-found error and the agent gets one fresh-observation recovery opportunity.

## Cursor telemetry

Every completed interaction can report:

```text
targetPoint       logical target center or action point
targetBounds      optional element/window bounds
display           native display index/identity when available
coordinateSystem  windows-physical-virtual-screen or mac-global-screen-points
interactionMethod accessibility-native, element-coordinate, vision-coordinate,
                  coordinate-input, or keyboard-input
```

The main process forwards only geometry and action state to the virtual Agent Cursor. Semantic actions therefore remain visible even if the physical pointer never moves. The Electron overlay is transparent, always-on-top, non-focusable, click-through, DPI-aware, and hidden while idle or stopped. It spans the virtual desktop so negative secondary-monitor origins are supported.

Move, click, double-click, drag, scroll, and typing events use transform-based motion and short pulses. Reduced motion disables travel and ripple animation while retaining a clear target marker.

## Tool surface

| Product tool | AI tool | Purpose |
| --- | --- | --- |
| `computer.listApps` | `computer_list_apps` | List visible applications |
| `computer.listWindows` | `computer_list_windows` | List top-level windows |
| `computer.inspectWindow` | `computer_inspect_window` | Return a bounded accessibility tree |
| `computer.captureScreen` | `computer_capture_screen` | Capture one reduced screenshot |
| `computer.launchApp` | `computer_launch_app` | Launch an approved named application |
| `computer.focusWindow` | `computer_focus_window` | Focus a window |
| `computer.click` | `computer_click` | Coordinate fallback |
| `computer.clickElement` | `computer_click_element` | Semantic click with fresh lookup |
| `computer.doubleClick` | `computer_double_click` | Coordinate double click |
| `computer.typeText` | `computer_type_text` | Bounded text input |
| `computer.pressKey` | `computer_press_key` | Safe key or key chord |
| `computer.scroll` | `computer_scroll` | Scroll the focused window |
| `computer.wait` | `computer_wait` | Wait for UI settling |
| `computer.finish` | `computer_finish` | Tell the runtime the task is complete |

All inputs are validated before dispatch and again by the native protocol. The runtime stops after the configured bounded action limit, cancellation, or terminal failure.

## Platform notes

Windows initializes PerMonitorV2 before UI Automation and screen APIs. UI Automation bounds, pointer input, and full-screen captures use physical virtual-screen pixels; captures report origin, bounds, DPI, and scale. macOS accessibility and CGEvent input use global desktop points; CoreGraphics image dimensions remain physical pixels and carry a scale factor plus capture bounds for mapping.

## Qualification mode

`OPENUSE_QUALIFICATION_MODE=1` exposes normalized debugging data in the local qualification surface: native status, PID, heartbeat, last interaction method, target geometry, screenshot dimensions/origin/DPI, and bounded element counts. It never displays or stores chain-of-thought, API keys, passwords, screenshots, or full private UI values in the persisted report.
