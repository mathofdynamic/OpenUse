import { describe, expect, it } from "vitest";
import { OpenUseError, asOpenUseError, redactText } from "./index.js";

describe("shared error and redaction helpers", () => {
  it("preserves OpenUse error codes", () => {
    const error = new OpenUseError("WINDOW_NOT_FOUND", "The window is gone.");

    expect(asOpenUseError(error, "IPC_ERROR")).toBe(error);
    expect(error.code).toBe("WINDOW_NOT_FOUND");
  });

  it("redacts content while retaining its length", () => {
    expect(redactText("secret text")).toBe("[redacted 11 chars]");
  });
});
