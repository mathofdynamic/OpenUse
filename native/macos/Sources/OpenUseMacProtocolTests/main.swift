import Foundation
import OpenUseMacCore

func require(_ condition: @autoclosure () -> Bool, _ message: String) {
    guard condition() else {
        FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8))
        exit(1)
    }
}

do {
    let request = try parseNativeRequest("{\"id\":\"r1\",\"method\":\"typeText\",\"params\":{\"text\":\"Hello • 世界\"}}")
    require(request.id == "r1", "Unicode request id")
    require(request.method == "typeText", "request method")
    require(request.params["text"] as? String == "Hello • 世界", "Unicode request value")
    do {
        _ = try parseNativeRequest("not-json")
        require(false, "malformed JSON must be rejected")
    } catch let error as NativeProtocolError {
        require(error.code == "INVALID_TOOL_INPUT", "malformed JSON error code")
    }
    let response = nativeFailure("r2", code: "ELEMENT_NOT_FOUND", message: "Missing")
    let object = try JSONSerialization.jsonObject(with: response) as? [String: Any]
    require(object?["id"] as? String == "r2", "failure response id")
    require(object?["ok"] as? Bool == false, "failure response status")
    require((object?["error"] as? [String: Any])?["code"] as? String == "ELEMENT_NOT_FOUND", "failure response code")
    print("OpenUse macOS protocol tests: PASS")
} catch {
    FileHandle.standardError.write(Data("FAIL: \(error)\n".utf8))
    exit(1)
}
