import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import OpenUseMacCore
import UniformTypeIdentifiers

private let maxInspectionElements = 360
private let maxInspectionDepth = 8
private let maxObservationBytes = 120_000
private let maxCaptureWidth = 1440

private final class CancellationToken {
    private let lock = NSLock()
    private var cancelled = false

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }

    var isCancelled: Bool {
        lock.lock()
        let value = cancelled
        lock.unlock()
        return value
    }

    func throwIfCancelled() throws {
        if isCancelled {
            throw NativeProtocolError(code: "TASK_CANCELLED", message: "The native action was cancelled.")
        }
    }

    func wait(milliseconds: Int) throws {
        let deadline = Date().addingTimeInterval(Double(milliseconds) / 1000)
        while Date() < deadline {
            try throwIfCancelled()
            Thread.sleep(forTimeInterval: min(0.02, max(0, deadline.timeIntervalSinceNow)))
        }
        try throwIfCancelled()
    }
}

private final class MacSidecar {
    private let controller = MacComputerController()
    private let actionQueue = DispatchQueue(label: "com.openuse.macos-controller.actions", qos: .userInitiated)
    private let tokenLock = NSLock()
    private var tokens: [String: CancellationToken] = [:]
    private let outputLock = NSLock()

    func run() -> Int32 {
        while let line = readLine(strippingNewline: true) {
            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            accept(line)
        }
        actionQueue.sync {}
        return 0
    }

    private func accept(_ line: String) {
        do {
            let request = try parseNativeRequest(line)
            if request.method.caseInsensitiveCompare("cancel") == .orderedSame {
                handleCancel(request)
                return
            }
            let token = CancellationToken()
            tokenLock.lock()
            if tokens[request.id] != nil {
                tokenLock.unlock()
                throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Request ID \(request.id) was already used.")
            }
            tokens[request.id] = token
            tokenLock.unlock()
            actionQueue.async { [weak self] in
                guard let self else { return }
                self.process(request, token: token)
            }
        } catch let error as NativeProtocolError {
            write(nativeFailure(requestIdFromMalformedLine(line), code: error.code, message: error.message))
        } catch {
            write(nativeFailure(requestIdFromMalformedLine(line), code: "IPC_ERROR", message: "The macOS controller could not accept the request."))
            stderr("request acceptance failed: \(error)")
        }
    }

    private func process(_ request: NativeRequest, token: CancellationToken) {
        do {
            let result = try controller.dispatch(request.method, params: request.params, token: token)
            write(nativeSuccess(request.id, result))
        } catch let error as NativeProtocolError {
            write(nativeFailure(request.id, code: error.code, message: error.message))
        } catch {
            stderr("request failed: \(error)")
            write(nativeFailure(request.id, code: "IPC_ERROR", message: "The macOS controller failed to complete the request."))
        }
        tokenLock.lock()
        tokens.removeValue(forKey: request.id)
        tokenLock.unlock()
    }

    private func handleCancel(_ request: NativeRequest) {
        do {
            let requestId = try stringParam(request.params, "requestId")
            tokenLock.lock()
            let token = tokens[requestId]
            token?.cancel()
            tokenLock.unlock()
            write(nativeSuccess(request.id, ["ok": true, "cancelled": token != nil]))
        } catch let error as NativeProtocolError {
            write(nativeFailure(request.id, code: error.code, message: error.message))
        } catch {
            write(nativeFailure(request.id, code: "IPC_ERROR", message: "The macOS controller could not cancel the request."))
        }
    }

    private func write(_ data: Data) {
        outputLock.lock()
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
        outputLock.unlock()
    }

    private func stderr(_ message: String) {
        FileHandle.standardError.write(Data("OpenUse macOS controller: \(message)\n".utf8))
    }
}

private final class MacComputerController {
    func dispatch(_ method: String, params: [String: Any], token: CancellationToken) throws -> Any {
        try token.throwIfCancelled()
        switch method {
        case "listApps": return ["apps": listApps()]
        case "listWindows": return ["windows": listWindows()]
        case "inspectWindow": return try inspectWindow(try stringParam(params, "windowId"))
        case "captureScreen": return try captureScreen(optionalStringParam(params, "windowId"))
        case "launchApp": return try launchApp(params, token: token)
        case "focusWindow": return try focusWindow(try stringParam(params, "windowId"), token: token)
        case "click": return try click(params, token: token)
        case "clickElement": return try clickElement(params, token: token)
        case "doubleClick": return try doubleClick(params, token: token)
        case "typeText": return try typeText(params, token: token)
        case "pressKey": return try pressKey(params, token: token)
        case "scroll": return try scroll(params, token: token)
        case "wait":
            let milliseconds = try boundedInt(params, "milliseconds", min: 50, max: 10_000)
            try token.wait(milliseconds: milliseconds)
            return ["ok": true, "waitedMs": milliseconds]
        case "selfTest": return selfTest()
        default: throw NativeProtocolError(code: "UNSUPPORTED_ACTION", message: "Unknown native method: \(method)")
        }
    }

    private func listApps() -> [[String: Any]] {
        var seen = Set<String>()
        var apps: [[String: Any]] = []
        for application in NSWorkspace.shared.runningApplications where !application.isTerminated {
            let pid = Int(application.processIdentifier)
            guard pid > 0 else { continue }
            let name = application.localizedName ?? application.bundleURL?.deletingPathExtension().lastPathComponent ?? "Process \(pid)"
            let bundleId = application.bundleIdentifier
            let identity = stableAppIdentity(bundleId: bundleId, pid: pid)
            if seen.contains(identity) { continue }
            seen.insert(identity)
            apps.append([
                "id": "mac-app-\(pid)",
                "name": name,
                "processName": application.executableURL?.lastPathComponent ?? name,
                "processId": pid,
                "appIdentity": identity,
            ])
        }
        return apps.sorted { (left, right) in
            (left["name"] as? String ?? "").localizedCaseInsensitiveCompare(right["name"] as? String ?? "") == .orderedAscending
        }
    }

    private func listWindows() -> [[String: Any]] {
        let frontmostPid = Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
        guard let rawWindows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        var result: [[String: Any]] = []
        for raw in rawWindows {
            guard let layer = number(raw[kCGWindowLayer as String]), layer == 0,
                  let windowNumber = number(raw[kCGWindowNumber as String]),
                  let pid = number(raw[kCGWindowOwnerPID as String]), pid > 0,
                  let owner = raw[kCGWindowOwnerName as String] as? String,
                  let bounds = bounds(raw[kCGWindowBounds as String]), bounds.width > 0, bounds.height > 0 else { continue }
            let title = (raw[kCGWindowName as String] as? String) ?? ""
            let application = NSRunningApplication(processIdentifier: pid_t(pid))
            let appName = application?.localizedName ?? owner
            let bundleId = application?.bundleIdentifier
            result.append(windowInfo(
                id: windowId(windowNumber),
                title: title,
                app: appName,
                appIdentity: stableAppIdentity(bundleId: bundleId, pid: pid),
                processName: application?.executableURL?.lastPathComponent ?? owner,
                processId: pid,
                className: bundleId ?? "AXWindow",
                bounds: bounds,
                focused: pid == frontmostPid && result.isEmpty
            ))
        }
        // CGWindowList is top-to-bottom. A frontmost app may have more than one
        // window; only the first visible top-level window is the focused target.
        var foundFocused = false
        for index in result.indices {
            let pid = result[index]["processId"] as? Int ?? 0
            if pid == frontmostPid && !foundFocused {
                result[index]["focused"] = true
                foundFocused = true
            } else {
                result[index]["focused"] = false
            }
        }
        return result
    }

    private func inspectWindow(_ id: String) throws -> [String: Any] {
        try requireAccessibility()
        let window = try findWindow(id)
        let axWindow = try accessibilityWindow(for: window)
        var elements: [[String: Any]] = []
        var truncated = false
        visit(axWindow, path: [], parentId: nil, window: window, depth: 0, elements: &elements, truncated: &truncated)
        while observationSize(window: window, elements: elements, truncated: truncated) > maxObservationBytes, !elements.isEmpty {
            elements.removeLast()
            truncated = true
        }
        return ["window": window, "elements": elements, "truncated": truncated]
    }

    private func visit(
        _ element: AXUIElement,
        path: [Int],
        parentId: String?,
        window: [String: Any],
        depth: Int,
        elements: inout [[String: Any]],
        truncated: inout Bool
    ) {
        if depth > maxInspectionDepth || elements.count >= maxInspectionElements {
            truncated = true
            return
        }
        let descriptor = describe(element, path: path, parentId: parentId, window: window)
        var nextParentId = parentId
        if let descriptor, isUseful(descriptor) {
            elements.append(descriptor)
            nextParentId = descriptor["id"] as? String
        }
        let children = axElements(attribute(element, kAXChildrenAttribute as CFString))
        for (index, child) in children.enumerated() {
            if elements.count >= maxInspectionElements {
                truncated = true
                return
            }
            visit(child, path: path + [index], parentId: nextParentId, window: window, depth: depth + 1, elements: &elements, truncated: &truncated)
        }
    }

    private func describe(_ element: AXUIElement, path: [Int], parentId: String?, window: [String: Any]) -> [String: Any]? {
        let rawRole = stringAttribute(element, kAXRoleAttribute as CFString) ?? "AXUnknown"
        let subrole = stringAttribute(element, kAXSubroleAttribute as CFString)
        let title = stringAttribute(element, kAXTitleAttribute as CFString)
        let description = stringAttribute(element, kAXDescriptionAttribute as CFString)
        let rawValue = stringAttribute(element, kAXValueAttribute as CFString)
        let name = title?.isEmpty == false ? title! : (description ?? "")
        let bounds = elementBounds(element)
        let hidden = boolAttribute(element, kAXHiddenAttribute as CFString) ?? false
        let enabled = boolAttribute(element, kAXEnabledAttribute as CFString) ?? true
        let focused = boolAttribute(element, kAXFocusedAttribute as CFString) ?? false
        let identifier = stringAttribute(element, kAXIdentifierAttribute as CFString)
        let actions = actionNames(element)
        let id = elementId(window: window, path: path, role: rawRole, name: name, identifier: identifier)
        var result: [String: Any] = [
            "id": id,
            "role": friendlyRole(rawRole),
            "name": name,
            "className": subrole ?? rawRole,
            "bounds": boundsDictionary(bounds),
            "enabled": enabled,
            "offscreen": hidden || bounds.width <= 0 || bounds.height <= 0,
            "supportedPatterns": actions,
        ]
        if let parentId { result["parentId"] = parentId }
        if let subrole, !subrole.isEmpty { result["subrole"] = subrole }
        if let identifier, !identifier.isEmpty { result["automationId"] = identifier }
        if !isSecureRole(rawRole), let rawValue, rawValue.count <= 1000 { result["value"] = rawValue }
        result["focused"] = focused
        return result
    }

    private func launchApp(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let requested = try stringParam(params, "app").trimmingCharacters(in: .whitespacesAndNewlines)
        guard requested.count <= 160, !requested.contains("\n"), !requested.contains("\r") else {
            throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Application name is invalid.")
        }
        let arguments = try stringArrayParam(params, "arguments") ?? []
        try token.throwIfCancelled()
        let bundleId = knownBundleIdentifier(for: requested)
        let url: URL
        if let running = NSWorkspace.shared.runningApplications.first(where: { applicationMatches($0, requested) }), let bundleURL = running.bundleURL {
            url = bundleURL
        } else if let bundleId, let knownURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
            url = knownURL
        } else {
            throw NativeProtocolError(code: "WINDOW_NOT_FOUND", message: "The application \(requested) is not installed or could not be resolved safely.")
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.arguments = arguments
        let semaphore = DispatchSemaphore(value: 0)
        var launchError: Error?
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, error in
            launchError = error
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + 10) == .timedOut {
            throw NativeProtocolError(code: "ACTION_TIMEOUT", message: "Timed out while opening \(requested).")
        }
        try token.throwIfCancelled()
        if launchError != nil { throw NativeProtocolError(code: "UNSUPPORTED_ACTION", message: "macOS could not launch \(requested).") }
        return ["ok": true, "changed": true, "detail": "Requested \(requested) to open."]
    }

    private func focusWindow(_ id: String, token: CancellationToken) throws -> [String: Any] {
        let window = try findWindow(id)
        try token.throwIfCancelled()
        guard let application = NSRunningApplication(processIdentifier: window["processId"] as? Int32 ?? Int32(window["processId"] as? Int ?? 0)) else {
            throw NativeProtocolError(code: "WINDOW_NOT_FOUND", message: "The target application is no longer running.")
        }
        application.activate(options: [.activateIgnoringOtherApps, .activateAllWindows])
        if AXIsProcessTrusted(), let axWindow = try? accessibilityWindow(for: window) {
            _ = AXUIElementPerformAction(axWindow, kAXRaiseAction as CFString)
        }
        try token.throwIfCancelled()
        var focused = window
        focused["focused"] = true
        return ["ok": true, "changed": true, "window": focused, "detail": "Focused \(window["title"] as? String ?? "window").", "interactionMethod": "accessibility-native"]
    }

    private func click(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let x = try boundedCoordinate(params, "x")
        let y = try boundedCoordinate(params, "y")
        let button = (optionalStringParam(params, "button") ?? "left").lowercased()
        guard ["left", "right", "middle"].contains(button) else {
            throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The mouse button must be left, right, or middle.")
        }
        try token.throwIfCancelled()
        postMouse(at: CGPoint(x: x, y: y), button: button, count: 1)
        return ["ok": true, "changed": true, "detail": "Clicked \(button) mouse button.", "interactionMethod": "coordinate-input"]
    }

    private func doubleClick(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let x = try boundedCoordinate(params, "x")
        let y = try boundedCoordinate(params, "y")
        try token.throwIfCancelled()
        postMouse(at: CGPoint(x: x, y: y), button: "left", count: 2)
        return ["ok": true, "changed": true, "detail": "Double-clicked the requested position.", "interactionMethod": "coordinate-input"]
    }

    private func clickElement(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let window = try findWindow(try stringParam(params, "windowId"))
        try requireAccessibility()
        let selected = try resolveElement(params, window: window)
        guard boolAttribute(selected.element, kAXEnabledAttribute as CFString) ?? true else {
            throw NativeProtocolError(code: "STALE_UI_STATE", message: "The semantic control is disabled.")
        }
        let bounds = elementBounds(selected.element)
        guard bounds.width > 0, bounds.height > 0 else {
            throw NativeProtocolError(code: "STALE_UI_STATE", message: "The semantic control has no usable bounds.")
        }
        try token.throwIfCancelled()
        let actions = actionNames(selected.element)
        for action in [kAXPressAction, kAXConfirmAction, kAXShowMenuAction, kAXIncrementAction, kAXDecrementAction] {
            if actions.contains(action as String) {
                let result = AXUIElementPerformAction(selected.element, action as CFString)
                if result == .success {
                    return ["ok": true, "changed": true, "detail": "Activated \(selected.label).", "interactionMethod": "accessibility-native", "targetElementId": selected.id, "window": window]
                }
            }
        }
        try focusElement(selected.element)
        try token.throwIfCancelled()
        postMouse(at: CGPoint(x: bounds.midX, y: bounds.midY), button: "left", count: 1)
        return ["ok": true, "changed": true, "detail": "Clicked \(selected.label) by its bounds.", "interactionMethod": "element-coordinate", "targetElementId": selected.id, "window": window]
    }

    private func typeText(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let text = try stringParam(params, "text")
        guard text.count <= 20_000 else { throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Text is longer than the allowed limit.") }
        var target: ResolvedElement?
        if let windowId = optionalStringParam(params, "windowId") {
            let window = try findWindow(windowId)
            try requireAccessibility()
            if hasSelector(params) { target = try resolveElement(params, window: window) }
            if let target { try focusElement(target.element) }
        }
        try token.throwIfCancelled()
        if let target, !isSecureRole(stringAttribute(target.element, kAXRoleAttribute as CFString) ?? ""), canSetValue(target.element) {
            let result = AXUIElementSetAttributeValue(target.element, kAXValueAttribute as CFString, text as CFString)
            if result == .success {
                return ["ok": true, "changed": true, "detail": "Set \(text.count) characters through macOS Accessibility.", "interactionMethod": "accessibility-native", "targetElementId": target.id]
            }
        }
        try sendUnicodeText(text, token: token)
        var result: [String: Any] = ["ok": true, "changed": true, "detail": "Typed \(text.count) characters.", "interactionMethod": "keyboard-input"]
        if let target { result["targetElementId"] = target.id }
        return result
    }

    private func pressKey(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let key = try stringParam(params, "key")
        try token.throwIfCancelled()
        let parsed = try parseKeyChord(key)
        postKeyChord(parsed.keyCode, modifiers: parsed.modifiers)
        return ["ok": true, "changed": true, "detail": "Pressed \(key).", "interactionMethod": "keyboard-input"]
    }

    private func scroll(_ params: [String: Any], token: CancellationToken) throws -> [String: Any] {
        let amount = try boundedInt(params, "amount", min: -20, max: 20)
        guard amount != 0 else { throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Scroll amount cannot be zero.") }
        try token.throwIfCancelled()
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: Int32(-amount), wheel2: 0, wheel3: 0)
        event?.post(tap: .cghidEventTap)
        return ["ok": true, "changed": true, "detail": "Scrolled the focused application.", "interactionMethod": "coordinate-input"]
    }

    private func selfTest() -> [String: Any] {
        let accessibility = AXIsProcessTrusted()
        let screenPermission = CGPreflightScreenCaptureAccess()
        let monitors = monitorDiagnostics()
        let screenEnumeration = !monitors.isEmpty
        let windowEnumeration = !listWindows().isEmpty || screenEnumeration
        let screenshot = try? captureScreen(nil)
        let screenshotAvailable = screenshot != nil && screenPermission
        let inputAvailable = CGEventSource(stateID: .combinedSessionState) != nil
        var failures: [String] = []
        if !accessibility { failures.append("Accessibility permission") }
        if !screenPermission { failures.append("Screen Recording permission") }
        if !windowEnumeration { failures.append("window enumeration") }
        if !screenEnumeration { failures.append("screen enumeration") }
        if !screenshotAvailable { failures.append("screen capture") }
        if monitors.contains(where: { ($0["dpi"] as? Int ?? 0) <= 0 }) { failures.append("scale detection") }
        if !inputAvailable { failures.append("input API initialization") }
        var result: [String: Any] = [
            "ok": failures.isEmpty,
            "platform": "darwin",
            "uiAutomationAvailable": accessibility,
            "windowEnumerationAvailable": windowEnumeration,
            "screenEnumerationAvailable": screenEnumeration,
            "screenshotAvailable": screenshotAvailable,
            "dpiAvailable": !monitors.isEmpty,
            "inputApisAvailable": inputAvailable,
            "monitorCount": monitors.count,
            "monitors": monitors,
            "accessibilityPermission": accessibility ? "granted" : "denied",
            "screenRecordingPermission": screenPermission ? "granted" : "denied",
        ]
        if let screenshot {
            result["screenshot"] = [
                "width": screenshot["width"] as Any,
                "height": screenshot["height"] as Any,
                "dpi": screenshot["dpi"] as Any,
                "scaleFactor": screenshot["scaleFactor"] as Any,
                "coordinateSystem": screenshot["coordinateSystem"] as Any,
                "captureBounds": screenshot["captureBounds"] as Any,
            ]
        }
        if !failures.isEmpty {
            result["detail"] = "Unavailable: \(failures.joined(separator: ", ")). Grant Accessibility and Screen Recording access to OpenUse (or the development sidecar) in System Settings > Privacy & Security."
        }
        return result
    }

    private func captureScreen(_ windowId: String?) throws -> [String: Any] {
        let captureBounds: CGRect
        let source: String
        if let windowId {
            captureBounds = try findWindow(windowId).boundsValue
            source = "window"
        } else {
            captureBounds = unionMonitorBounds()
            source = "screen"
        }
        guard captureBounds.width > 0, captureBounds.height > 0 else {
            throw NativeProtocolError(code: "STALE_UI_STATE", message: "The screen capture bounds are empty.")
        }
        guard CGPreflightScreenCaptureAccess() else {
            throw NativeProtocolError(code: "SCREEN_RECORDING_PERMISSION_REQUIRED", message: "Screen Recording permission is required before OpenUse can capture the screen.")
        }
        let options: CGWindowImageOption = [.bestResolution, .boundsIgnoreFraming]
        let image = CGWindowListCreateImage(captureBounds, .optionOnScreenOnly, kCGNullWindowID, options)
        guard let image else { throw NativeProtocolError(code: "SCREEN_RECORDING_PERMISSION_REQUIRED", message: "macOS did not provide a screen image. Check Screen Recording permission.") }
        let originalScale = max(CGFloat(image.width) / max(captureBounds.width, 1), CGFloat(image.height) / max(captureBounds.height, 1))
        let outputImage = resizedImage(image, maxPixelWidth: maxCaptureWidth)
        guard let png = pngData(outputImage) else { throw NativeProtocolError(code: "UNSUPPORTED_ACTION", message: "macOS could not encode the screen image.") }
        let scale = originalScale > 0 ? originalScale : 1
        return [
            "data": png.base64EncodedString(),
            "mimeType": "image/png",
            "width": outputImage.width,
            "height": outputImage.height,
            "source": source,
            "coordinateSystem": "global-screen-points",
            "dpi": Int((scale * 72).rounded()),
            "scaleFactor": scale,
            "captureBounds": boundsDictionary(captureBounds),
        ]
    }

    private func resolveElement(_ params: [String: Any], window: [String: Any]) throws -> ResolvedElement {
        let axWindow = try accessibilityWindow(for: window)
        if let id = optionalStringParam(params, "elementId") {
            guard let resolved = resolveElementId(id, root: axWindow, window: window) else {
                throw NativeProtocolError(code: "STALE_UI_STATE", message: "The accessibility element is stale. Inspect the window again before retrying.")
            }
            return resolved
        }
        let inspection = try inspectWindow(window["id"] as? String ?? "")
        let selected = (inspection["elements"] as? [[String: Any]] ?? []).first { matches($0, params) }
        guard let selectedId = selected?["id"] as? String,
              let resolved = resolveElementId(selectedId, root: axWindow, window: window) else {
            throw NativeProtocolError(code: "ELEMENT_NOT_FOUND", message: "The requested semantic element was not found.")
        }
        return resolved
    }

    private func resolveElementId(_ id: String, root: AXUIElement, window: [String: Any]) -> ResolvedElement? {
        let parts = id.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 5, parts[0] == "mac-el",
              Int(parts[1]) == window["processId"] as? Int,
              Int(parts[2]) == windowNumber(from: window["id"] as? String ?? "") else { return nil }
        let path = parts[3] == "root" ? [] : parts[3].split(separator: ".").compactMap { Int($0) }
        guard parts[3] == "root" || path.count == parts[3].split(separator: ".").count else { return nil }
        var element = root
        for index in path {
            let children = axElements(attribute(element, kAXChildrenAttribute as CFString))
            guard children.indices.contains(index) else { return nil }
            element = children[index]
        }
        let role = stringAttribute(element, kAXRoleAttribute as CFString) ?? "AXUnknown"
        let title = stringAttribute(element, kAXTitleAttribute as CFString)
        let description = stringAttribute(element, kAXDescriptionAttribute as CFString)
        let name = title?.isEmpty == false ? title! : (description ?? "")
        let identifier = stringAttribute(element, kAXIdentifierAttribute as CFString)
        let expected = parts[4]
        guard fingerprint(role: role, name: name, identifier: identifier) == expected else { return nil }
        return ResolvedElement(element: element, id: id, label: name.isEmpty ? friendlyRole(role) : name)
    }

    private func accessibilityWindow(for window: [String: Any]) throws -> AXUIElement {
        guard let pid = window["processId"] as? Int else { throw NativeProtocolError(code: "WINDOW_NOT_FOUND", message: "The target window has no process identity.") }
        let application = AXUIElementCreateApplication(pid_t(pid))
        let windows = axElements(attribute(application, kAXWindowsAttribute as CFString))
        let title = window["title"] as? String ?? ""
        let expectedBounds = window.boundsValue
        if let exact = windows.first(where: {
            let candidateTitle = stringAttribute($0, kAXTitleAttribute as CFString) ?? ""
            return candidateTitle == title && rectDistance(elementBounds($0), expectedBounds) < 45
        }) { return exact }
        if let near = windows.first(where: { rectDistance(elementBounds($0), expectedBounds) < 90 }) { return near }
        throw NativeProtocolError(code: "STALE_UI_STATE", message: "macOS Accessibility could not match \(title.isEmpty ? "the target window" : title) to the current UI state. Inspect the window again before retrying.")
    }

    private func findWindow(_ id: String) throws -> [String: Any] {
        guard let window = listWindows().first(where: { ($0["id"] as? String) == id }) else {
            throw NativeProtocolError(code: "WINDOW_NOT_FOUND", message: "Window \(id) was not found or is no longer visible.")
        }
        return window
    }

    private func requireAccessibility() throws {
        guard AXIsProcessTrusted() else {
            throw NativeProtocolError(code: "ACCESSIBILITY_PERMISSION_REQUIRED", message: "Accessibility permission is required. Grant it to OpenUse in System Settings > Privacy & Security > Accessibility.")
        }
    }

    private func focusElement(_ element: AXUIElement) throws {
        let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        if result != .success {
            let focusResult = AXUIElementPerformAction(element, kAXRaiseAction as CFString)
            if focusResult != .success { /* Some text areas are focusable only by their bounds. */ }
        }
    }

    private func canSetValue(_ element: AXUIElement) -> Bool {
        var settable = DarwinBoolean(false)
        return AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
    }

    private func sendUnicodeText(_ text: String, token: CancellationToken) throws {
        let units = Array(text.utf16)
        var index = 0
        while index < units.count {
            try token.throwIfCancelled()
            let end = min(index + 20, units.count)
            let chunk = Array(units[index..<end])
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                throw NativeProtocolError(code: "UNSUPPORTED_ACTION", message: "macOS could not initialize keyboard input.")
            }
            chunk.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
                up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
            }
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            index = end
        }
    }

    private func parseKeyChord(_ input: String) throws -> (keyCode: CGKeyCode, modifiers: CGEventFlags) {
        let parts = input.split(separator: "+", omittingEmptySubsequences: true).map { String($0).trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }
        guard let main = parts.last, !main.isEmpty else { throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Key chord is empty.") }
        var flags = CGEventFlags()
        for modifier in parts.dropLast() {
            switch modifier {
            case "CMD", "COMMAND", "META": flags.insert(.maskCommand)
            case "CTRL", "CONTROL": flags.insert(.maskControl)
            case "ALT", "OPTION": flags.insert(.maskAlternate)
            case "SHIFT": flags.insert(.maskShift)
            case "FN", "FUNCTION": flags.insert(.maskSecondaryFn)
            default: throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Unknown key modifier: \(modifier).")
            }
        }
        guard let keyCode = macKeyCodes[main] ?? singleCharacterKeyCode(main) else {
            throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Unknown key: \(main).")
        }
        return (keyCode, flags)
    }

    private func postKeyChord(_ keyCode: CGKeyCode, modifiers: CGEventFlags) {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else { return }
        down.flags = modifiers
        up.flags = modifiers
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private func postMouse(at point: CGPoint, button: String, count: Int) {
        let mouseButton: CGMouseButton = button == "right" ? .right : button == "middle" ? .center : .left
        let downType: CGEventType = mouseButton == .right ? .rightMouseDown : mouseButton == .center ? .otherMouseDown : .leftMouseDown
        let upType: CGEventType = mouseButton == .right ? .rightMouseUp : mouseButton == .center ? .otherMouseUp : .leftMouseUp
        for index in 0..<count {
            CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: point, mouseButton: mouseButton)?.post(tap: .cghidEventTap)
            CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: point, mouseButton: mouseButton)?.post(tap: .cghidEventTap)
            if index + 1 < count { Thread.sleep(forTimeInterval: 0.055) }
        }
    }
}

private struct ResolvedElement {
    let element: AXUIElement
    let id: String
    let label: String
}

private let macKeyCodes: [String: CGKeyCode] = [
    "RETURN": 36, "ENTER": 36, "TAB": 48, "SPACE": 49, "ESC": 53, "ESCAPE": 53,
    "BACKSPACE": 51, "DELETE": 117, "FORWARDDELETE": 51, "UP": 126, "ARROWUP": 126,
    "DOWN": 125, "ARROWDOWN": 125, "LEFT": 123, "ARROWLEFT": 123, "RIGHT": 124, "ARROWRIGHT": 124,
    "HOME": 115, "END": 119, "PAGEUP": 116, "PAGEDOWN": 121, "F1": 122, "F2": 120,
    "F3": 99, "F4": 118, "F5": 96, "F6": 97, "F7": 98, "F8": 100, "F9": 101, "F10": 109,
    "F11": 103, "F12": 111, "MINUS": 27, "EQUALS": 24, "PLUS": 24,
]

private func singleCharacterKeyCode(_ value: String) -> CGKeyCode? {
    let codes: [String: CGKeyCode] = [
        "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7, "C": 8, "V": 9,
        "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16, "T": 17, "1": 18, "2": 19,
        "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27,
        "8": 28, "0": 29, "]": 30, "O": 31, "U": 32, "[": 33, "I": 34, "P": 35,
        "L": 37, "J": 38, "'": 39, "K": 40, ";": 41, "\\": 42, ",": 43, "/": 44,
        "N": 45, "M": 46, ".": 47,
    ]
    return codes[value]
}

private func boundedCoordinate(_ params: [String: Any], _ key: String) throws -> CGFloat {
    let value = try intParam(params, key)
    guard (-20_000...20_000).contains(value) else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Screen coordinates are outside the allowed bounds.")
    }
    return CGFloat(value)
}

private func boundedInt(_ params: [String: Any], _ key: String, min: Int, max: Int) throws -> Int {
    let value = try intParam(params, key)
    guard (min...max).contains(value) else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The parameter \(key) is outside the allowed bounds.")
    }
    return value
}

private func hasSelector(_ params: [String: Any]) -> Bool {
    ["elementId", "role", "name", "automationId", "className"].contains { optionalStringParam(params, $0) != nil }
}

private func matches(_ element: [String: Any], _ params: [String: Any]) -> Bool {
    let comparisons: [(String, String)] = [
        ("role", "role"), ("name", "name"), ("automationId", "automationId"), ("className", "className"),
    ]
    for (elementKey, paramKey) in comparisons {
        guard let expected = optionalStringParam(params, paramKey) else { continue }
        guard (element[elementKey] as? String)?.caseInsensitiveCompare(expected) == .orderedSame else { return false }
    }
    return true
}

private func actionNames(_ element: AXUIElement) -> [String] {
    var raw: CFArray?
    guard AXUIElementCopyActionNames(element, &raw) == .success else { return [] }
    return (raw as? [String] ?? []).sorted()
}

private func attribute(_ element: AXUIElement, _ key: CFString) -> Any? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key, &value) == .success else { return nil }
    return value
}

private func stringAttribute(_ element: AXUIElement, _ key: CFString) -> String? {
    if let value = attribute(element, key) as? String { return value }
    if let value = attribute(element, key) as? NSString { return value as String }
    return nil
}

private func boolAttribute(_ element: AXUIElement, _ key: CFString) -> Bool? {
    if let value = attribute(element, key) as? Bool { return value }
    if let value = attribute(element, key) as? NSNumber { return value.boolValue }
    return nil
}

private func axElements(_ value: Any?) -> [AXUIElement] {
    if let value = value as? [AXUIElement] { return value }
    if let value = value as? NSArray { return value.map { $0 as! AXUIElement } }
    return []
}

private func elementBounds(_ element: AXUIElement) -> CGRect {
    var position = CGPoint.zero
    var size = CGSize.zero
    if let rawPosition = attribute(element, kAXPositionAttribute as CFString) { _ = AXValueGetValue(rawPosition as! AXValue, .cgPoint, &position) }
    if let rawSize = attribute(element, kAXSizeAttribute as CFString) { _ = AXValueGetValue(rawSize as! AXValue, .cgSize, &size) }
    return CGRect(origin: position, size: size)
}

private func bounds(_ value: Any?) -> CGRect? {
    guard let dictionary = value as? NSDictionary else { return nil }
    var rectangle = CGRect.zero
    guard CGRectMakeWithDictionaryRepresentation(dictionary, &rectangle) else { return nil }
    return rectangle
}

private func boundsDictionary(_ rectangle: CGRect) -> [String: Any] {
    ["x": Int(rectangle.origin.x.rounded()), "y": Int(rectangle.origin.y.rounded()), "width": Int(rectangle.width.rounded()), "height": Int(rectangle.height.rounded())]
}

private func windowInfo(id: String, title: String, app: String, appIdentity: String, processName: String, processId: Int, className: String, bounds: CGRect, focused: Bool) -> [String: Any] {
    ["id": id, "title": title, "app": app, "appIdentity": appIdentity, "processName": processName, "processId": processId, "className": className, "bounds": boundsDictionary(bounds), "focused": focused]
}

private func observationSize(window: [String: Any], elements: [[String: Any]], truncated: Bool) -> Int {
    let object: [String: Any] = ["window": window, "elements": elements, "truncated": truncated]
    return (try? JSONSerialization.data(withJSONObject: object).count) ?? maxObservationBytes + 1
}

private func isUseful(_ element: [String: Any]) -> Bool {
    let role = (element["role"] as? String ?? "").lowercased()
    let name = element["name"] as? String ?? ""
    let actions = element["supportedPatterns"] as? [String] ?? []
    let bounds = element["bounds"] as? [String: Any]
    let visible = (element["offscreen"] as? Bool) != true && (bounds?["width"] as? Int ?? 0) > 0 && (bounds?["height"] as? Int ?? 0) > 0
    if !visible { return false }
    if !actions.isEmpty || element["value"] != nil { return true }
    if ["button", "checkbox", "combobox", "edit", "link", "menuitem", "radio", "slider", "textfield", "textarea", "statictext", "window"].contains(role) { return true }
    return !name.isEmpty && !["group", "scrollarea", "splitgroup", "toolbar", "unknown"].contains(role)
}

private func friendlyRole(_ role: String) -> String {
    let value = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
    switch value {
    case "TextField": return "TextField"
    case "TextArea": return "TextArea"
    case "StaticText": return "StaticText"
    case "PopUpButton": return "PopUpButton"
    default: return value
    }
}

private func isSecureRole(_ role: String) -> Bool { role.lowercased().contains("secure") || role.lowercased().contains("password") }

private func windowId(_ number: Int) -> String { "mac-window-\(number)" }

private func windowNumber(from id: String) -> Int? {
    guard id.hasPrefix("mac-window-") else { return nil }
    return Int(id.dropFirst("mac-window-".count))
}

private func elementId(window: [String: Any], path: [Int], role: String, name: String, identifier: String?) -> String {
    let pid = window["processId"] as? Int ?? 0
    let number = windowNumber(from: window["id"] as? String ?? "") ?? 0
    let pathValue = path.isEmpty ? "root" : path.map(String.init).joined(separator: ".")
    return "mac-el:\(pid):\(number):\(pathValue):\(fingerprint(role: role, name: name, identifier: identifier))"
}

private func fingerprint(role: String, name: String, identifier: String?) -> String {
    let input = "\(role)|\(name)|\(identifier ?? "")"
    var hash: UInt64 = 14695981039346656037
    for byte in input.utf8 { hash = (hash ^ UInt64(byte)) &* 1099511628211 }
    return String(hash, radix: 16)
}

private func stableAppIdentity(bundleId: String?, pid: Int) -> String { bundleId.map { "bundle:\($0)" } ?? "pid:\(pid)" }

private func knownBundleIdentifier(for app: String) -> String? {
    switch app.lowercased().replacingOccurrences(of: ".app", with: "") {
    case "textedit", "text edit": return "com.apple.TextEdit"
    case "calculator", "calc": return "com.apple.calculator"
    case "finder": return "com.apple.finder"
    default: return app.contains(".") ? app : nil
    }
}

private func applicationMatches(_ application: NSRunningApplication, _ requested: String) -> Bool {
    let normalized = requested.lowercased().replacingOccurrences(of: ".app", with: "")
    return [application.localizedName, application.bundleIdentifier, application.executableURL?.deletingPathExtension().lastPathComponent]
        .compactMap { $0?.lowercased().replacingOccurrences(of: ".app", with: "") }
        .contains { $0 == normalized || $0.contains(normalized) || normalized.contains($0) }
}

private func monitorDiagnostics() -> [[String: Any]] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
    var displays = Array(repeating: CGDirectDisplayID(), count: Int(count))
    guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return [] }
    return displays.enumerated().map { index, display in
        let rectangle = CGDisplayBounds(display)
        let scaleX = rectangle.width > 0 ? CGFloat(CGDisplayPixelsWide(display)) / rectangle.width : 1
        let scaleY = rectangle.height > 0 ? CGFloat(CGDisplayPixelsHigh(display)) / rectangle.height : 1
        let scale = max(scaleX, scaleY)
        return [
            "index": index,
            "bounds": boundsDictionary(rectangle),
            "workArea": boundsDictionary(rectangle),
            "dpi": Int((scale * 72).rounded()),
            "scaleFactor": Double(scale),
            "primary": display == CGMainDisplayID(),
        ]
    }
}

private func unionMonitorBounds() -> CGRect {
    monitorDiagnostics().compactMap { $0["bounds"] as? [String: Any] }.reduce(CGRect.null) { partial, value in
        let rectangle = CGRect(x: value["x"] as? Int ?? 0, y: value["y"] as? Int ?? 0, width: value["width"] as? Int ?? 0, height: value["height"] as? Int ?? 0)
        return partial.isNull ? rectangle : partial.union(rectangle)
    }
}

private func resizedImage(_ image: CGImage, maxPixelWidth: Int) -> CGImage {
    guard image.width > maxPixelWidth else { return image }
    let width = maxPixelWidth
    let height = max(1, Int((Double(image.height) * Double(width) / Double(image.width)).rounded()))
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage() ?? image
}

private func pngData(_ image: CGImage) -> Data? {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { return nil }
    return data as Data
}

private func rectDistance(_ left: CGRect, _ right: CGRect) -> CGFloat {
    abs(left.origin.x - right.origin.x) + abs(left.origin.y - right.origin.y) + abs(left.width - right.width) + abs(left.height - right.height)
}

private extension Dictionary where Key == String, Value == Any {
    var boundsValue: CGRect {
        guard let value = self["bounds"] as? [String: Any] else { return .zero }
        return CGRect(x: value["x"] as? Int ?? 0, y: value["y"] as? Int ?? 0, width: value["width"] as? Int ?? 0, height: value["height"] as? Int ?? 0)
    }
}

private func number(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? NSNumber { return value.intValue }
    return nil
}

private let sidecar = MacSidecar()
exit(sidecar.run())
