using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Automation;

namespace OpenUse.WindowsController;

public sealed class WindowsComputerController
{
    private const int MaxInspectionElements = 360;
    private const int MaxInspectionDepth = 6;
    private const int MaxObservationBytes = 120_000;
    private const int MaxCaptureWidth = 1440;
    private const int SwRestore = 9;
    private const uint MouseEventLeftDown = 0x0002;
    private const uint MouseEventLeftUp = 0x0004;
    private const uint MouseEventRightDown = 0x0008;
    private const uint MouseEventRightUp = 0x0010;
    private const uint MouseEventMiddleDown = 0x0020;
    private const uint MouseEventMiddleUp = 0x0040;
    private const uint MouseEventWheel = 0x0800;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const uint InputKeyboard = 1;
    private const uint MonitorInfoPrimary = 1;
    private const uint MonitorDefaultToNull = 0;

    private static readonly (AutomationPattern Pattern, string Name)[] PatternDefinitions =
    {
        (InvokePattern.Pattern, "Invoke"),
        (ValuePattern.Pattern, "Value"),
        (TextPattern.Pattern, "Text"),
        (SelectionItemPattern.Pattern, "SelectionItem"),
        (TogglePattern.Pattern, "Toggle"),
        (ExpandCollapsePattern.Pattern, "ExpandCollapse"),
        (ScrollItemPattern.Pattern, "ScrollItem"),
        (RangeValuePattern.Pattern, "RangeValue"),
    };

    public Task<object> DispatchAsync(string method, System.Text.Json.JsonElement parameters, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return method switch
        {
            "listApps" => Task.FromResult<object>(ListApps()),
            "listWindows" => Task.FromResult<object>(ListWindows()),
            "inspectWindow" => Task.FromResult<object>(InspectWindow(Protocol.ReadParams<InspectWindowParams>(parameters).WindowId)),
            "captureScreen" => Task.FromResult<object>(CaptureScreen(Protocol.ReadParams<CaptureScreenParams>(parameters).WindowId)),
            "launchApp" => Task.FromResult<object>(LaunchApp(Protocol.ReadParams<LaunchAppParams>(parameters), cancellationToken)),
            "focusWindow" => Task.FromResult<object>(FocusWindow(Protocol.ReadParams<FocusWindowParams>(parameters).WindowId, cancellationToken)),
            "click" => Task.FromResult<object>(Click(Protocol.ReadParams<ClickParams>(parameters), cancellationToken)),
            "clickElement" => Task.FromResult<object>(ClickElement(Protocol.ReadParams<ClickElementParams>(parameters), cancellationToken)),
            "doubleClick" => Task.FromResult<object>(DoubleClick(Protocol.ReadParams<DoubleClickParams>(parameters), cancellationToken)),
            "typeText" => Task.FromResult<object>(TypeText(Protocol.ReadParams<TypeTextParams>(parameters), cancellationToken)),
            "pressKey" => Task.FromResult<object>(PressKey(Protocol.ReadParams<PressKeyParams>(parameters), cancellationToken)),
            "scroll" => Task.FromResult<object>(Scroll(Protocol.ReadParams<ScrollParams>(parameters), cancellationToken)),
            "wait" => WaitAsync(Protocol.ReadParams<WaitParams>(parameters).Milliseconds, cancellationToken),
            "selfTest" => Task.FromResult<object>(SelfTest()),
            _ => throw new NativeControllerException("UNSUPPORTED_ACTION", $"Unknown native method: {method}"),
        };
    }

    private static object ListApps()
    {
        var apps = new Dictionary<int, AppInfo>();
        foreach (var process in Process.GetProcesses())
        {
            try
            {
                if (process.MainWindowHandle == IntPtr.Zero || string.IsNullOrWhiteSpace(process.MainWindowTitle)) continue;
                var processName = process.ProcessName;
                var title = process.MainWindowTitle;
                var name = processName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)
                    ? PackagedApplicationName(title)
                    : FriendlyProcessName(process, processName);
                var id = process.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
                apps[process.Id] = new AppInfo(id, name, processName, process.Id, StableAppIdentity(processName, string.Empty, name, process.Id));
            }
            catch
            {
                // Processes can disappear between enumeration and property access.
            }
            finally
            {
                process.Dispose();
            }
        }
        return new { apps = apps.Values.OrderBy(app => app.Name, StringComparer.OrdinalIgnoreCase).ToArray() };
    }

    private static object ListWindows()
    {
        var windows = new List<WindowInfo>();
        var focused = GetForegroundWindow();
        EnumWindows((handle, _) =>
        {
            // Keep owned, visible dialogs such as Notepad's Save As window in the
            // observation set; the agent needs those transient UI states.
            if (!IsWindowVisible(handle)) return true;
            var title = ReadWindowTitle(handle);
            if (string.IsNullOrWhiteSpace(title)) return true;
            try
            {
                windows.Add(ReadWindow(handle, focused));
            }
            catch
            {
                // Ignore a window that closed during enumeration.
            }
            return true;
        }, IntPtr.Zero);
        return new { windows = windows.OrderByDescending(window => window.Focused).ThenBy(window => window.Title, StringComparer.OrdinalIgnoreCase).ToArray() };
    }

    private static WindowInspection InspectWindow(string windowId)
    {
        var handle = ParseWindowHandle(windowId);
        var window = ReadWindow(handle, GetForegroundWindow());
        AutomationElement root;
        try
        {
            root = AutomationElement.FromHandle(handle);
        }
        catch
        {
            throw new NativeControllerException("WINDOW_NOT_FOUND", $"Windows UI Automation could not open {window.Title}.");
        }

        var elements = new List<UiElement>();
        var walker = TreeWalker.ControlViewWalker;
        var sequence = 0;
        var truncated = false;

        void Visit(AutomationElement element, int depth, string? parentId)
        {
            if (depth > MaxInspectionDepth || elements.Count >= MaxInspectionElements)
            {
                truncated = true;
                return;
            }
            sequence += 1;
            var id = StableElementId(element, sequence);
            var control = ReadElement(element, id, parentId);
            var nextParentId = parentId;
            if (control is not null)
            {
                elements.Add(control);
                nextParentId = control.Id;
            }
            AutomationElement? child;
            try { child = walker.GetFirstChild(element); }
            catch { return; }
            while (child is not null)
            {
                Visit(child, depth + 1, nextParentId);
                if (elements.Count >= MaxInspectionElements) { truncated = true; return; }
                try { child = walker.GetNextSibling(child); }
                catch { return; }
            }
        }

        Visit(root, 0, null);
        elements = elements
            .OrderByDescending(IsActionable)
            .ThenBy(element => element.ParentId is null ? 0 : 1)
            .ThenBy(element => element.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        while (elements.Count > 1 && ObservationSize(window, elements, truncated) > MaxObservationBytes)
        {
            elements.RemoveAt(elements.Count - 1);
            truncated = true;
        }
        return new WindowInspection(window, elements, truncated);
    }

    private static OperationResult LaunchApp(LaunchAppParams input, CancellationToken cancellationToken)
    {
        var app = input.App?.Trim() ?? string.Empty;
        if (app.Length == 0 || app.Length > 160 || app.Contains('\n') || app.Contains('\r'))
            throw new NativeControllerException("INVALID_TOOL_INPUT", "Application name is invalid.");
        if (input.Arguments is not null && (input.Arguments.Length > 12 || input.Arguments.Any(argument => argument is null || argument.Length > 400)))
            throw new NativeControllerException("INVALID_TOOL_INPUT", "Application arguments are outside the allowed bounds.");
        var executable = ResolveApplication(app);
        if (IsBlockedExecutable(executable))
            throw new NativeControllerException("UNSUPPORTED_ACTION", "Shells, installers, and scripting hosts are disabled in OpenUse.");
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            // CreateProcess-style launch avoids URI/file associations and shell
            // handlers. The tool surface is for executables, not command
            // interpreters or arbitrary shell actions.
            var startInfo = new ProcessStartInfo { FileName = executable, UseShellExecute = false };
            if (input.Arguments is not null)
            {
                foreach (var argument in input.Arguments) startInfo.ArgumentList.Add(argument);
            }
            Process.Start(startInfo);
            return new OperationResult(true, true, null, $"Requested {app} to open.");
        }
        catch
        {
            throw new NativeControllerException("UNSUPPORTED_ACTION", $"Windows could not launch {app}.");
        }
    }

    private static OperationResult FocusWindow(string windowId, CancellationToken cancellationToken)
    {
        var handle = ParseWindowHandle(windowId);
        var window = ReadWindow(handle, GetForegroundWindow());
        cancellationToken.ThrowIfCancellationRequested();
        ShowWindow(handle, SwRestore);
        cancellationToken.ThrowIfCancellationRequested();
        if (!SetForegroundWindow(handle)) throw new NativeControllerException("STALE_UI_STATE", $"Could not focus {window.Title}.");
        return new OperationResult(true, true, ReadWindow(handle, handle), $"Focused {window.Title}.");
    }

    private static OperationResult Click(ClickParams input, CancellationToken cancellationToken)
    {
        if (!input.X.HasValue || !input.Y.HasValue) throw new NativeControllerException("INVALID_TOOL_INPUT", "Both click coordinates are required.");
        ValidateCoordinates(input.X.Value, input.Y.Value);
        var button = (input.Button ?? "left").ToLowerInvariant();
        if (button is not ("left" or "right" or "middle"))
            throw new NativeControllerException("INVALID_TOOL_INPUT", "The mouse button must be left, right, or middle.");
        cancellationToken.ThrowIfCancellationRequested();
        MoveCursor(input.X.Value, input.Y.Value);
        cancellationToken.ThrowIfCancellationRequested();
        var flags = button switch
        {
            "right" => (MouseEventRightDown, MouseEventRightUp),
            "middle" => (MouseEventMiddleDown, MouseEventMiddleUp),
            _ => (MouseEventLeftDown, MouseEventLeftUp),
        };
        mouse_event(flags.Item1, 0, 0, 0, UIntPtr.Zero);
        mouse_event(flags.Item2, 0, 0, 0, UIntPtr.Zero);
        return new OperationResult(true, true, null, $"Clicked {button} mouse button.", "coordinate-input");
    }

    private static OperationResult ClickElement(ClickElementParams input, CancellationToken cancellationToken)
    {
        try
        {
            return ClickElementCore(input, cancellationToken);
        }
        catch (ElementNotAvailableException)
        {
            throw new NativeControllerException("STALE_UI_STATE", "The semantic control disappeared before it could be activated.");
        }
        catch (InvalidOperationException)
        {
            throw new NativeControllerException("STALE_UI_STATE", "The semantic control could not be activated in its current state.");
        }
    }

    private static OperationResult ClickElementCore(ClickElementParams input, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(input.WindowId) || input.ElementId is null && input.Role is null && input.Name is null && input.AutomationId is null && input.ClassName is null)
            throw new NativeControllerException("INVALID_TOOL_INPUT", "A semantic element selector is required.");
        var windowHandle = ParseWindowHandle(input.WindowId);
        var window = ReadWindow(windowHandle, GetForegroundWindow());
        cancellationToken.ThrowIfCancellationRequested();
        ShowWindow(windowHandle, SwRestore);
        cancellationToken.ThrowIfCancellationRequested();
        if (!SetForegroundWindow(windowHandle)) throw new NativeControllerException("STALE_UI_STATE", "Could not focus the target window before clicking.");
        var match = FindElement(windowHandle, input.ElementId, input.Role, input.Name, input.AutomationId, input.ClassName);
        var element = match.Element;
        var targetElementId = match.Id;
        if (!element.Current.IsEnabled || element.Current.IsOffscreen)
            throw new NativeControllerException("STALE_UI_STATE", "The semantic control is disabled or offscreen.");
        if (ElementBounds(element).Width <= 0 || ElementBounds(element).Height <= 0)
            throw new NativeControllerException("STALE_UI_STATE", "The semantic control no longer has usable bounds.");
        cancellationToken.ThrowIfCancellationRequested();
        try { element.SetFocus(); } catch { /* Some controls cannot receive focus. */ }
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke))
        {
            cancellationToken.ThrowIfCancellationRequested();
            ((InvokePattern)invoke).Invoke();
            return new OperationResult(true, true, window, $"Invoked {ElementLabel(element)}.", "accessibility-native", targetElementId);
        }
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var selection))
        {
            cancellationToken.ThrowIfCancellationRequested();
            ((SelectionItemPattern)selection).Select();
            return new OperationResult(true, true, window, $"Selected {ElementLabel(element)}.", "accessibility-native", targetElementId);
        }
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out var toggle))
        {
            cancellationToken.ThrowIfCancellationRequested();
            ((TogglePattern)toggle).Toggle();
            return new OperationResult(true, true, window, $"Toggled {ElementLabel(element)}.", "accessibility-native", targetElementId);
        }
        var bounds = ElementBounds(element);
        cancellationToken.ThrowIfCancellationRequested();
        MoveCursor(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2);
        cancellationToken.ThrowIfCancellationRequested();
        mouse_event(MouseEventLeftDown, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MouseEventLeftUp, 0, 0, 0, UIntPtr.Zero);
        return new OperationResult(true, true, window, $"Clicked {ElementLabel(element)} by its bounds.", "element-coordinate", targetElementId);
    }

    private static OperationResult DoubleClick(DoubleClickParams input, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!input.X.HasValue || !input.Y.HasValue) throw new NativeControllerException("INVALID_TOOL_INPUT", "Both double-click coordinates are required.");
        ValidateCoordinates(input.X.Value, input.Y.Value);
        cancellationToken.ThrowIfCancellationRequested();
        MoveCursor(input.X.Value, input.Y.Value);
        cancellationToken.ThrowIfCancellationRequested();
        mouse_event(MouseEventLeftDown, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MouseEventLeftUp, 0, 0, 0, UIntPtr.Zero);
        if (cancellationToken.WaitHandle.WaitOne(55)) throw new OperationCanceledException(cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        mouse_event(MouseEventLeftDown, 0, 0, 0, UIntPtr.Zero);
        mouse_event(MouseEventLeftUp, 0, 0, 0, UIntPtr.Zero);
        return new OperationResult(true, true, null, "Double-clicked the requested position.", "coordinate-input");
    }

    private static OperationResult TypeText(TypeTextParams input, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (string.IsNullOrEmpty(input.Text) || input.Text.Length > 20000)
            throw new NativeControllerException("INVALID_TOOL_INPUT", "Text must contain between 1 and 20000 characters.");
        if (input.WindowId is not null)
        {
            var handle = ParseWindowHandle(input.WindowId);
            cancellationToken.ThrowIfCancellationRequested();
            ShowWindow(handle, SwRestore);
            cancellationToken.ThrowIfCancellationRequested();
            if (!SetForegroundWindow(handle)) throw new NativeControllerException("STALE_UI_STATE", "Could not focus the target window before typing.");
        }
        AutomationElement? target = null;
        string? targetElementId = null;
        if (input.WindowId is not null && (input.ElementId is not null || input.Role is not null || input.Name is not null || input.AutomationId is not null || input.ClassName is not null))
        {
            var match = FindElement(ParseWindowHandle(input.WindowId), input.ElementId, input.Role, input.Name, input.AutomationId, input.ClassName);
            target = match.Element;
            targetElementId = match.Id;
            try { target.SetFocus(); }
            catch (ElementNotAvailableException) { throw new NativeControllerException("STALE_UI_STATE", "The target text control disappeared before typing."); }
            catch (InvalidOperationException) { throw new NativeControllerException("STALE_UI_STATE", "The target text control could not receive focus."); }
        }
        EnsureNotCredentialElement(target);
        AutomationElement? focused = null;
        try { focused = AutomationElement.FocusedElement; }
        catch { throw new NativeControllerException("UNSUPPORTED_ACTION", "OpenUse could not safely inspect the focused control before typing."); }
        EnsureNotCredentialElement(focused);
        if (target is not null && TrySetValue(target, input.Text))
            return new OperationResult(true, true, null, $"Set {input.Text.Length} characters through UI Automation.", "accessibility-native", targetElementId);
        if (target is null && focused is not null && TrySetValue(focused, input.Text))
            return new OperationResult(true, true, null, $"Set {input.Text.Length} characters through UI Automation.", "accessibility-native", targetElementId);
        SendUnicodeText(input.Text, cancellationToken);
        return new OperationResult(true, true, null, $"Typed {input.Text.Length} characters.", "keyboard-input", targetElementId);
    }

    private static bool TrySetValue(AutomationElement element, string text)
    {
        try
        {
            if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)) return false;
            var value = (ValuePattern)pattern;
            if (value.Current.IsReadOnly) return false;
            value.SetValue(text);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void EnsureNotCredentialElement(AutomationElement? element)
    {
        if (element is null) return;
        try
        {
            var role = RoleFor(element.Current.ControlType);
            var name = element.Current.Name ?? string.Empty;
            var automationId = element.Current.AutomationId ?? string.Empty;
            var className = element.Current.ClassName ?? string.Empty;
            if (CredentialWords.IsMatch($"{role} {name} {automationId} {className}"))
                throw new NativeControllerException("CREDENTIAL_INTERACTION_DISABLED", "Credential and password entry is disabled in OpenUse.");
        }
        catch (NativeControllerException)
        {
            throw;
        }
        catch (ElementNotAvailableException)
        {
            throw new NativeControllerException("STALE_UI_STATE", "The focused control disappeared before OpenUse could verify it.");
        }
        catch (InvalidOperationException)
        {
            throw new NativeControllerException("STALE_UI_STATE", "The focused control could not be verified before typing.");
        }
        catch
        {
            throw new NativeControllerException("UNSUPPORTED_ACTION", "OpenUse could not safely verify the focused control before typing.");
        }
    }

    private static OperationResult PressKey(PressKeyParams input, CancellationToken cancellationToken)
    {
        var key = input.Key?.Trim() ?? string.Empty;
        if (key.Length == 0 || key.Length > 80) throw new NativeControllerException("INVALID_TOOL_INPUT", "Key must contain between 1 and 80 characters.");
        cancellationToken.ThrowIfCancellationRequested();
        SendKeyChord(key);
        return new OperationResult(true, true, null, $"Pressed {key.ToUpperInvariant()}.", "keyboard-input");
    }

    private static OperationResult Scroll(ScrollParams input, CancellationToken cancellationToken)
    {
        if (!input.Amount.HasValue || input.Amount is < -20 or > 20) throw new NativeControllerException("INVALID_TOOL_INPUT", "Scroll amount must be between -20 and 20.");
        if (input.X.HasValue != input.Y.HasValue) throw new NativeControllerException("INVALID_TOOL_INPUT", "Scroll coordinates must be supplied together.");
        if (input.X.HasValue && input.Y.HasValue) ValidateCoordinates(input.X.Value, input.Y.Value);
        cancellationToken.ThrowIfCancellationRequested();
        if (input.X.HasValue && input.Y.HasValue) MoveCursor(input.X.Value, input.Y.Value);
        cancellationToken.ThrowIfCancellationRequested();
        mouse_event(MouseEventWheel, 0, 0, unchecked((uint)(input.Amount.Value * 120)), UIntPtr.Zero);
        return new OperationResult(true, true, null, $"Scrolled {input.Amount} units.", "coordinate-input");
    }

    private static Task<object> WaitAsync(int milliseconds, CancellationToken cancellationToken)
    {
        if (milliseconds is < 50 or > 10000) throw new NativeControllerException("INVALID_TOOL_INPUT", "Wait must be between 50ms and 10000ms.");
        cancellationToken.ThrowIfCancellationRequested();
        if (cancellationToken.WaitHandle.WaitOne(milliseconds)) throw new OperationCanceledException(cancellationToken);
        return Task.FromResult<object>(new { ok = true, waitedMs = milliseconds });
    }

    private static SelfTestResult SelfTest()
    {
        var uiAutomationAvailable = false;
        try
        {
            uiAutomationAvailable = AutomationElement.RootElement is not null;
        }
        catch { }

        var windowEnumerationAvailable = false;
        try
        {
            _ = ListWindows();
            windowEnumerationAvailable = true;
        }
        catch { }

        var monitors = new List<MonitorInfo>();
        try { monitors = EnumerateMonitors(); }
        catch { }
        var screenEnumerationAvailable = monitors.Count > 0 && GetSystemMetrics(78) > 0 && GetSystemMetrics(79) > 0;
        var dpiAvailable = monitors.Count > 0 && monitors.All(monitor => monitor.Dpi > 0);

        ScreenshotDiagnostics? screenshot = null;
        var screenshotAvailable = false;
        try
        {
            // Capture and immediately dispose of the image data. The self-test
            // verifies the capture path without persisting or returning pixels.
            var capture = CaptureScreen(null);
            screenshot = new ScreenshotDiagnostics(capture.Width, capture.Height, capture.Dpi, capture.CoordinateSystem, capture.CaptureBounds);
            screenshotAvailable = true;
        }
        catch { }

        var inputApisAvailable = false;
        try
        {
            inputApisAvailable = GetCursorPos(out _);
        }
        catch { }

        var failures = new List<string>();
        if (!uiAutomationAvailable) failures.Add("UI Automation");
        if (!windowEnumerationAvailable) failures.Add("window enumeration");
        if (!screenEnumerationAvailable) failures.Add("screen enumeration");
        if (!screenshotAvailable) failures.Add("screen capture");
        if (!dpiAvailable) failures.Add("DPI detection");
        if (!inputApisAvailable) failures.Add("input API initialization");
        return new SelfTestResult(
            failures.Count == 0,
            uiAutomationAvailable,
            windowEnumerationAvailable,
            screenEnumerationAvailable,
            screenshotAvailable,
            dpiAvailable,
            inputApisAvailable,
            monitors.Count,
            monitors,
            screenshot,
            failures.Count == 0 ? null : $"Unavailable: {string.Join(", ", failures)}.");
    }

    private static List<MonitorInfo> EnumerateMonitors()
    {
        var monitors = new List<MonitorInfo>();
        bool Callback(IntPtr monitorHandle, IntPtr deviceContext, ref RECT callbackRectangle, IntPtr state)
        {
            var info = new MONITORINFO { CbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(monitorHandle, ref info)) return true;
            var dpi = ReadMonitorDpi(monitorHandle);
            monitors.Add(new MonitorInfo(
                monitors.Count,
                ToBounds(info.Monitor),
                ToBounds(info.Work),
                dpi,
                (info.Flags & MonitorInfoPrimary) != 0));
            return true;
        }

        if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, Callback, IntPtr.Zero)) return [];
        return monitors;
    }

    private static int ReadMonitorDpi(IntPtr monitorHandle)
    {
        try
        {
            // GetDpiForWindow is DPI-aware. Avoid GetDpiForMonitor here because
            // Microsoft documents that API as unsuitable for per-monitor-aware
            // callers.
            var representativeWindow = FindRepresentativeWindow(monitorHandle);
            if (representativeWindow != IntPtr.Zero)
            {
                var windowDpi = GetDpiForWindow(representativeWindow);
                if (windowDpi > 0) return (int)windowDpi;
            }
        }
        catch { }
        try
        {
            var systemDpi = GetDpiForSystem();
            return systemDpi > 0 ? (int)systemDpi : 0;
        }
        catch { return 0; }
    }

    private static IntPtr FindRepresentativeWindow(IntPtr monitorHandle)
    {
        var found = IntPtr.Zero;
        EnumWindows((handle, _) =>
        {
            if (!IsWindowVisible(handle) || !GetWindowRect(handle, out var rectangle)) return true;
            var windowMonitor = MonitorFromRect(ref rectangle, MonitorDefaultToNull);
            if (windowMonitor != monitorHandle) return true;
            found = handle;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    private static Bounds ToBounds(RECT rectangle) => new(rectangle.Left, rectangle.Top, rectangle.Right - rectangle.Left, rectangle.Bottom - rectangle.Top);

    private static Screenshot CaptureScreen(string? windowId)
    {
        int x;
        int y;
        int width;
        int height;
        var source = "screen";
        var dpi = (int)GetDpiForSystem();
        if (windowId is not null)
        {
            var handle = ParseWindowHandle(windowId);
            var rectangle = new RECT();
            if (!GetWindowRect(handle, out rectangle)) throw new NativeControllerException("WINDOW_NOT_FOUND", "Could not read the target window bounds.");
            x = rectangle.Left;
            y = rectangle.Top;
            width = rectangle.Right - rectangle.Left;
            height = rectangle.Bottom - rectangle.Top;
            source = "window";
            dpi = (int)GetDpiForWindow(handle);
        }
        else
        {
            x = GetSystemMetrics(76);
            y = GetSystemMetrics(77);
            width = GetSystemMetrics(78);
            height = GetSystemMetrics(79);
        }
        if (width <= 0 || height <= 0) throw new NativeControllerException("STALE_UI_STATE", "The capture bounds are empty.");
        if ((long)width * height > 20_000_000) throw new NativeControllerException("UNSUPPORTED_ACTION", "The target screen is too large for a bounded model capture.");
        using var original = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(original))
        {
            graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
        }
        using var resized = ResizeForModel(original);
        using var output = new MemoryStream();
        resized.Save(output, ImageFormat.Png);
        return new Screenshot(
            Convert.ToBase64String(output.ToArray()),
            "image/png",
            resized.Width,
            resized.Height,
            source,
            "virtual-screen-physical-pixels",
            dpi <= 0 ? 96 : dpi,
            new Bounds(x, y, width, height));
    }

    private static Bitmap ResizeForModel(Bitmap source)
    {
        if (source.Width <= MaxCaptureWidth) return new Bitmap(source);
        var width = MaxCaptureWidth;
        var height = Math.Max(1, (int)Math.Round(source.Height * (width / (double)source.Width)));
        var resized = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(resized);
        graphics.CompositingMode = CompositingMode.SourceCopy;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.DrawImage(source, new Rectangle(0, 0, width, height));
        return resized;
    }

    private sealed record ElementMatch(AutomationElement Element, string Id);

    private static ElementMatch FindElement(IntPtr windowHandle, string? elementId, string? role, string? name, string? automationId, string? className)
    {
        AutomationElement root;
        try { root = AutomationElement.FromHandle(windowHandle); }
        catch { throw new NativeControllerException("WINDOW_NOT_FOUND", "The target window is no longer available."); }
        var walker = TreeWalker.ControlViewWalker;
        var sequence = 0;
        ElementMatch? found = null;

        void Visit(AutomationElement element, int depth)
        {
            if (found is not null || depth > MaxInspectionDepth) return;
            sequence += 1;
            var currentId = StableElementId(element, sequence);
            if (Matches(element, currentId, elementId, role, name, automationId, className)) { found = new ElementMatch(element, currentId); return; }
            AutomationElement? child;
            try { child = walker.GetFirstChild(element); } catch { return; }
            while (child is not null && found is null)
            {
                Visit(child, depth + 1);
                try { child = walker.GetNextSibling(child); } catch { return; }
            }
        }
        Visit(root, 0);
        return found ?? throw new NativeControllerException("ELEMENT_NOT_FOUND", "No matching semantic UI element was found. Inspect the window again.");
    }

    private static bool Matches(AutomationElement element, string currentId, string? wantedId, string? wantedRole, string? wantedName, string? wantedAutomationId, string? wantedClassName)
    {
        try
        {
            var role = RoleFor(element.Current.ControlType);
            var currentName = element.Current.Name ?? string.Empty;
            var currentAutomationId = element.Current.AutomationId ?? string.Empty;
            var currentClassName = element.Current.ClassName ?? string.Empty;
            if (wantedId is not null && !currentId.Equals(wantedId, StringComparison.OrdinalIgnoreCase)) return false;
            if (wantedAutomationId is not null && !currentAutomationId.Equals(wantedAutomationId, StringComparison.OrdinalIgnoreCase)) return false;
            if (wantedRole is not null && !role.Equals(wantedRole, StringComparison.OrdinalIgnoreCase)) return false;
            if (wantedName is not null && !currentName.Equals(wantedName, StringComparison.OrdinalIgnoreCase)) return false;
            if (wantedClassName is not null && !currentClassName.Equals(wantedClassName, StringComparison.OrdinalIgnoreCase)) return false;
            return wantedId is not null || wantedRole is not null || wantedName is not null || wantedAutomationId is not null || wantedClassName is not null;
        }
        catch { return false; }
    }

    private static UiElement? ReadElement(AutomationElement element, string id, string? parentId)
    {
        try
        {
            var role = RoleFor(element.Current.ControlType);
            var name = element.Current.Name ?? string.Empty;
            var automationId = element.Current.AutomationId;
            var className = element.Current.ClassName ?? string.Empty;
            var bounds = ElementBounds(element);
            var enabled = element.Current.IsEnabled;
            var offscreen = element.Current.IsOffscreen;
            var actionable = new[] { "Button", "CheckBox", "ComboBox", "Document", "Edit", "Hyperlink", "ListItem", "MenuItem", "RadioButton", "TabItem", "Text", "TreeItem", "Slider", "Spinner" }.Contains(role, StringComparer.OrdinalIgnoreCase);
            if (offscreen || string.IsNullOrWhiteSpace(name) && !actionable) return null;
            if (bounds.Width <= 0 || bounds.Height <= 0) return null;
            return new UiElement(
                id,
                parentId,
                role,
                TrimObservation(name),
                string.IsNullOrWhiteSpace(automationId) ? null : TrimObservation(automationId),
                TrimObservation(className),
                bounds,
                enabled,
                offscreen,
                SupportedPatterns(element),
                ReadElementValue(element, role, name, automationId, className));
        }
        catch { return null; }
    }

    private static string StableElementId(AutomationElement element, int fallback)
    {
        try
        {
            var runtimeId = element.GetRuntimeId();
            if (runtimeId is { Length: > 0 }) return $"el_{string.Join("_", runtimeId)}";
        }
        catch { }
        return $"el_{fallback}";
    }

    private static string[] SupportedPatterns(AutomationElement element)
    {
        var patterns = new List<string>();
        foreach (var definition in PatternDefinitions)
        {
            try
            {
                if (element.TryGetCurrentPattern(definition.Pattern, out _)) patterns.Add(definition.Name);
            }
            catch { }
        }
        return patterns.ToArray();
    }

    private static bool IsActionable(UiElement element) =>
        element.SupportedPatterns.Count > 0 || element.Role is "Button" or "CheckBox" or "ComboBox" or "Document" or "Edit" or "Hyperlink" or "ListItem" or "MenuItem" or "RadioButton" or "TabItem" or "TreeItem" or "Slider" or "Spinner";

    private static string? ReadElementValue(AutomationElement element, string role, string name, string? automationId, string className)
    {
        if (CredentialWords.IsMatch($"{role} {name} {automationId} {className}")) return null;
        if (role is not ("Document" or "Edit" or "Text" or "ComboBox" or "ListItem" or "Window")) return null;
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var valuePattern))
            {
                var value = ((ValuePattern)valuePattern).Current.Value;
                return string.IsNullOrWhiteSpace(value) ? null : TrimObservation(value);
            }
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out var textPattern))
            {
                var text = ((TextPattern)textPattern).DocumentRange.GetText(1000).TrimEnd('\r', '\n');
                return string.IsNullOrWhiteSpace(text) ? null : TrimObservation(text);
            }
        }
        catch { }
        return null;
    }

    private static string TrimObservation(string value)
    {
        const int maxLength = 512;
        var normalized = value.Replace("\0", string.Empty, StringComparison.Ordinal);
        return normalized.Length <= maxLength ? normalized : $"{normalized[..maxLength]}…";
    }

    private static int ObservationSize(WindowInfo window, IReadOnlyList<UiElement> elements, bool truncated) =>
        JsonSerializer.SerializeToUtf8Bytes(new WindowInspection(window, elements, truncated), Protocol.JsonOptions).Length;

    private static Bounds ElementBounds(AutomationElement element)
    {
        var rectangle = element.Current.BoundingRectangle;
        if (double.IsNaN(rectangle.X) || double.IsNaN(rectangle.Y)) return new Bounds(0, 0, 0, 0);
        return new Bounds((int)Math.Round(rectangle.X), (int)Math.Round(rectangle.Y), Math.Max(0, (int)Math.Round(rectangle.Width)), Math.Max(0, (int)Math.Round(rectangle.Height)));
    }

    private static string ElementLabel(AutomationElement element)
    {
        try { return string.IsNullOrWhiteSpace(element.Current.Name) ? RoleFor(element.Current.ControlType) : element.Current.Name; }
        catch { return "element"; }
    }

    private static string RoleFor(ControlType type) => type.Id switch
    {
        50000 => "Button",
        50001 => "Calendar",
        50002 => "CheckBox",
        50003 => "ComboBox",
        50004 => "Edit",
        50005 => "Hyperlink",
        50006 => "Image",
        50007 => "ListItem",
        50008 => "List",
        50009 => "Menu",
        50010 => "MenuBar",
        50011 => "MenuItem",
        50012 => "ProgressBar",
        50013 => "RadioButton",
        50014 => "ScrollBar",
        50015 => "Slider",
        50016 => "Spinner",
        50017 => "StatusBar",
        50018 => "Tab",
        50019 => "TabItem",
        50020 => "Text",
        50021 => "ToolBar",
        50022 => "ToolTip",
        50023 => "Tree",
        50024 => "TreeItem",
        50025 => "Custom",
        50026 => "Group",
        50027 => "Thumb",
        50028 => "DataGrid",
        50029 => "DataItem",
        50030 => "Document",
        50031 => "SplitButton",
        50032 => "Window",
        _ => "Control",
    };

    private static WindowInfo ReadWindow(IntPtr handle, IntPtr focused)
    {
        if (handle == IntPtr.Zero || !IsWindow(handle)) throw new NativeControllerException("WINDOW_NOT_FOUND", "The target window is no longer available.");
        GetWindowThreadProcessId(handle, out var processId);
        var processName = "unknown";
        try
        {
            using var process = Process.GetProcessById((int)processId);
            processName = process.ProcessName;
        }
        catch { }
        if (!GetWindowRect(handle, out var rectangle)) throw new NativeControllerException("WINDOW_NOT_FOUND", "Could not read the target window bounds.");
        var title = ReadWindowTitle(handle);
        var app = FriendlyProcessName(processName);
        if (processName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(title)) app = PackagedApplicationName(title);
        var className = ReadClassName(handle);
        var appIdentity = StableAppIdentity(processName, className, app, (int)processId);
        return new WindowInfo(
            handle.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture),
            title,
            app,
            appIdentity,
            processName,
            (int)processId,
            className,
            new Bounds(rectangle.Left, rectangle.Top, rectangle.Right - rectangle.Left, rectangle.Bottom - rectangle.Top),
            handle == focused);
    }

    private static IntPtr ParseWindowHandle(string value)
    {
        if (!long.TryParse(value, out var handleValue) || handleValue == 0) throw new NativeControllerException("WINDOW_NOT_FOUND", "The window ID is invalid.");
        var handle = new IntPtr(handleValue);
        if (!IsWindow(handle)) throw new NativeControllerException("WINDOW_NOT_FOUND", "The target window is no longer available.");
        return handle;
    }

    private static string ReadWindowTitle(IntPtr handle)
    {
        var length = GetWindowTextLength(handle);
        if (length <= 0) return string.Empty;
        var builder = new StringBuilder(length + 1);
        GetWindowText(handle, builder, builder.Capacity);
        return builder.ToString();
    }

    private static string ReadClassName(IntPtr handle)
    {
        var builder = new StringBuilder(256);
        return GetClassName(handle, builder, builder.Capacity) > 0 ? builder.ToString() : string.Empty;
    }

    private static string StableAppIdentity(string processName, string className, string displayName, int? processId = null)
    {
        var process = string.IsNullOrWhiteSpace(processName) ? "unknown" : processName.Trim().ToLowerInvariant();
        var windowClass = string.IsNullOrWhiteSpace(className) ? "unknown" : className.Trim().ToLowerInvariant();
        if (!process.Equals("applicationframehost", StringComparison.OrdinalIgnoreCase) && processId.HasValue)
        {
            var aumid = ReadApplicationUserModelId(processId.Value);
            if (!string.IsNullOrWhiteSpace(aumid)) return $"aumid:{aumid.Trim().ToLowerInvariant()}";
        }
        if (process.Equals("applicationframehost", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(displayName))
            return $"packaged:{displayName.Trim().ToLowerInvariant()}";
        return $"win32:{process}:{windowClass}";
    }

    private static string? ReadApplicationUserModelId(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            var length = 0u;
            var result = GetApplicationUserModelId(process.Handle, ref length, null);
            if (result != ErrorInsufficientBuffer || length == 0) return null;
            var buffer = new StringBuilder((int)length);
            return GetApplicationUserModelId(process.Handle, ref length, buffer) == 0 ? buffer.ToString() : null;
        }
        catch { return null; }
    }

    private static string FriendlyProcessName(Process process, string fallback)
    {
        var knownName = FriendlyProcessName(fallback);
        if (!knownName.Equals(fallback, StringComparison.Ordinal)) return knownName;
        try
        {
            var fileName = process.MainModule?.FileName;
            if (fileName is not null)
            {
                var description = FileVersionInfo.GetVersionInfo(fileName).FileDescription;
                if (!string.IsNullOrWhiteSpace(description)) return description;
            }
        }
        catch { }
        return FriendlyProcessName(fallback);
    }

    private static string FriendlyProcessName(string processName)
    {
        return processName.ToLowerInvariant() switch
        {
            "notepad" => "Notepad",
            "calculatorapp" or "calc" => "Calculator",
            "explorer" => "Explorer",
            "chrome" => "Chrome",
            _ => processName,
        };
    }

    private static string PackagedApplicationName(string title)
    {
        var separator = title.LastIndexOf(" - ", StringComparison.Ordinal);
        return separator >= 0 && separator + 3 < title.Length ? title[(separator + 3)..].Trim() : title.Trim();
    }

    private static string ResolveApplication(string app)
    {
        var lower = app.ToLowerInvariant();
        return lower switch
        {
            "notepad" or "notepad.exe" => "notepad.exe",
            "calculator" or "calc" or "calc.exe" => "calc.exe",
            "explorer" or "file explorer" or "explorer.exe" => "explorer.exe",
            "chrome" or "google chrome" or "chrome.exe" => "chrome.exe",
            _ => app,
        };
    }

    private static bool IsBlockedExecutable(string value)
    {
        var name = Path.GetFileName(value).ToLowerInvariant();
        return name is "cmd.exe" or "powershell.exe" or "pwsh.exe" or "wscript.exe" or "cscript.exe" or "msiexec.exe" or "rundll32.exe" or "regsvr32.exe" or "setup.exe" or "install.exe" or "installer.exe"
            || name.EndsWith(".msi", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith(".bat", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith(".ps1", StringComparison.OrdinalIgnoreCase);
    }

    private static readonly Regex CredentialWords = new(@"\b(password|passcode|credential|secret|security code|one[- ]time code|otp)(?:\b|box|field)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);
    private const int ErrorInsufficientBuffer = 122;

    private static void MoveCursor(int x, int y)
    {
        if (!SetCursorPos(x, y)) throw new NativeControllerException("UNSUPPORTED_ACTION", "Windows rejected the pointer position.");
    }

    private static void ValidateCoordinates(int x, int y)
    {
        if (x is < -20000 or > 20000 || y is < -20000 or > 20000)
            throw new NativeControllerException("INVALID_TOOL_INPUT", "Screen coordinates are outside the allowed bounds.");
    }

    private static void SendUnicodeText(string text, CancellationToken cancellationToken)
    {
        var inputs = new List<INPUT>(text.Length * 2);
        foreach (var character in text)
        {
            cancellationToken.ThrowIfCancellationRequested();
            inputs.Add(KeyboardInput(0, character, KeyEventUnicode));
            inputs.Add(KeyboardInput(0, character, KeyEventUnicode | KeyEventKeyUp));
        }
        SendInputs(inputs);
    }

    private static void SendKeyChord(string value)
    {
        var parts = value.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) throw new NativeControllerException("INVALID_TOOL_INPUT", "Key chord is empty.");
        var modifiers = new List<ushort>();
        for (var index = 0; index < parts.Length - 1; index += 1) modifiers.Add(Modifier(parts[index]));
        var main = parts[^1];
        var key = VirtualKey(main);
        var inputs = new List<INPUT>();
        foreach (var modifier in modifiers) inputs.Add(KeyboardInput(modifier, 0, 0));
        inputs.Add(KeyboardInput(key, 0, 0));
        inputs.Add(KeyboardInput(key, 0, KeyEventKeyUp));
        for (var index = modifiers.Count - 1; index >= 0; index -= 1) inputs.Add(KeyboardInput(modifiers[index], 0, KeyEventKeyUp));
        SendInputs(inputs);
    }

    private static readonly Dictionary<string, ushort> VirtualKeyNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ENTER"] = 0x0D, ["RETURN"] = 0x0D, ["ESCAPE"] = 0x1B, ["ESC"] = 0x1B,
        ["TAB"] = 0x09, ["BACKSPACE"] = 0x08, ["DELETE"] = 0x2E, ["DEL"] = 0x2E,
        ["SPACE"] = 0x20, ["UP"] = 0x26, ["ARROWUP"] = 0x26, ["DOWN"] = 0x28, ["ARROWDOWN"] = 0x28,
        ["LEFT"] = 0x25, ["ARROWLEFT"] = 0x25, ["RIGHT"] = 0x27, ["ARROWRIGHT"] = 0x27,
        ["HOME"] = 0x24, ["END"] = 0x23, ["PAGEUP"] = 0x21, ["PAGEDOWN"] = 0x22,
        ["PLUS"] = 0xBB, ["ADD"] = 0x6B, ["MINUS"] = 0xBD, ["SUBTRACT"] = 0x6D,
        ["DECIMAL"] = 0x6E, ["MULTIPLY"] = 0x6A, ["DIVIDE"] = 0x6F,
        ["INSERT"] = 0x2D, ["F1"] = 0x70, ["F2"] = 0x71, ["F3"] = 0x72, ["F4"] = 0x73,
        ["F5"] = 0x74, ["F6"] = 0x75, ["F7"] = 0x76, ["F8"] = 0x77, ["F9"] = 0x78,
        ["F10"] = 0x79, ["F11"] = 0x7A, ["F12"] = 0x7B,
    };

    private static ushort Modifier(string value) => value.ToUpperInvariant() switch
    {
        "CTRL" or "CONTROL" => 0xA2,
        "ALT" => 0xA4,
        "SHIFT" => 0x10,
        "WIN" or "META" or "COMMAND" => 0x5B,
        _ => throw new NativeControllerException("INVALID_TOOL_INPUT", $"Unknown key modifier: {value}"),
    };

    private static ushort VirtualKey(string value)
    {
        var normalized = value.ToUpperInvariant();
        if (VirtualKeyNames.TryGetValue(normalized, out var named)) return named;
        if (normalized.Length == 1 && ((normalized[0] >= 'A' && normalized[0] <= 'Z') || (normalized[0] >= '0' && normalized[0] <= '9'))) return normalized[0];
        throw new NativeControllerException("INVALID_TOOL_INPUT", $"Unknown key: {value}");
    }

    private static INPUT KeyboardInput(ushort virtualKey, ushort scanCode, uint flags)
    {
        return new INPUT
        {
            Type = InputKeyboard,
            Data = new InputUnion { Keyboard = new KEYBDINPUT { VirtualKey = virtualKey, ScanCode = scanCode, Flags = flags } },
        };
    }

    private static void SendInputs(List<INPUT> inputs)
    {
        if (inputs.Count == 0 || SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>()) != inputs.Count)
            throw new NativeControllerException("UNSUPPORTED_ACTION", "Windows rejected the requested input.");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MONITORINFO
    {
        public int CbSize;
        public RECT Monitor;
        public RECT Work;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint Type; public InputUnion Data; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT Mouse;
        [FieldOffset(0)] public KEYBDINPUT Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int X; public int Y; public uint MouseData; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort VirtualKey; public ushort ScanCode; public uint Flags; public uint Time; public UIntPtr ExtraInfo; }

    private delegate bool EnumWindowsProc(IntPtr handle, IntPtr state);
    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr deviceContext, ref RECT monitorRectangle, IntPtr state);

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr handle, int command);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr handle, out RECT rectangle);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr handle, StringBuilder className, int maxCount);
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll")] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr handle);
    [DllImport("user32.dll")] private static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr deviceContext, IntPtr clipRectangle, MonitorEnumProc callback, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO monitorInfo);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromRect(ref RECT rectangle, uint flags);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern int GetApplicationUserModelId(IntPtr processHandle, ref uint applicationUserModelIdLength, StringBuilder? applicationUserModelId);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }
}
