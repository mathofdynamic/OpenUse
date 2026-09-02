import Foundation

public struct NativeRequest {
    public let id: String
    public let method: String
    public let params: [String: Any]

    public init(id: String, method: String, params: [String: Any]) {
        self.id = id
        self.method = method
        self.params = params
    }
}

public struct NativeProtocolError: Error, Equatable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

public func parseNativeRequest(_ line: String) throws -> NativeRequest {
    guard let data = line.data(using: .utf8) else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The request was not valid UTF-8.")
    }
    let raw: Any
    do {
        raw = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    } catch {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Invalid JSON request.")
    }
    guard let object = raw as? [String: Any],
          let id = object["id"] as? String, !id.isEmpty,
          let method = object["method"] as? String, !method.isEmpty else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "A request requires a non-empty id and method.")
    }
    guard let params = object["params"] as? [String: Any] else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "Request params must be a JSON object.")
    }
    return NativeRequest(id: id, method: method, params: params)
}

public func requestIdFromMalformedLine(_ line: String) -> String {
    guard let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = object["id"] as? String, !id.isEmpty else { return "unknown" }
    return id
}

public func nativeSuccess(_ id: String, _ result: Any) -> Data {
    encodeResponse(["id": id, "ok": true, "result": result])
}

public func nativeFailure(_ id: String, code: String, message: String) -> Data {
    encodeResponse(["id": id, "ok": false, "error": ["code": code, "message": message]])
}

private func encodeResponse(_ response: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: response, options: [])) ?? Data("{\"id\":\"unknown\",\"ok\":false,\"error\":{\"code\":\"IPC_ERROR\",\"message\":\"Could not encode native response.\"}}\n".utf8)
}

public func stringParam(_ params: [String: Any], _ key: String) throws -> String {
    guard let value = params[key] as? String, !value.isEmpty else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The parameter \(key) must be a non-empty string.")
    }
    return value
}

public func optionalStringParam(_ params: [String: Any], _ key: String) -> String? {
    guard let value = params[key] as? String, !value.isEmpty else { return nil }
    return value
}

public func intParam(_ params: [String: Any], _ key: String, defaultValue: Int? = nil) throws -> Int {
    if let value = params[key] as? Int { return value }
    if let value = params[key] as? NSNumber { return value.intValue }
    if let defaultValue { return defaultValue }
    throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The parameter \(key) must be an integer.")
}

public func boolParam(_ params: [String: Any], _ key: String, defaultValue: Bool = false) -> Bool {
    (params[key] as? Bool) ?? defaultValue
}

public func stringArrayParam(_ params: [String: Any], _ key: String) throws -> [String]? {
    guard let raw = params[key] else { return nil }
    guard let values = raw as? [Any] else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The parameter \(key) must be an array.")
    }
    let strings = values.compactMap { $0 as? String }
    guard strings.count == values.count, strings.count <= 12, strings.allSatisfy({ $0.count <= 400 }) else {
        throw NativeProtocolError(code: "INVALID_TOOL_INPUT", message: "The application arguments are outside the allowed bounds.")
    }
    return strings
}
