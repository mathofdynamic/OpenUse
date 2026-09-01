import { describe, expect, it } from "vitest";
import { nativeRequestSchema, nativeResponseSchema } from "./index";

describe("native JSON-lines protocol", () => {
  it("accepts a structured response", () => {
    expect(nativeResponseSchema.parse({ id: "r1", ok: true, result: { changed: true } })).toMatchObject({ ok: true });
  });

  it("rejects messages without request identity", () => {
    expect(() => nativeRequestSchema.parse({ method: "listWindows", params: {} })).toThrow();
  });

  it("rejects responses without a matching result or error", () => {
    expect(() => nativeResponseSchema.parse({ id: "r1", ok: true })).toThrow();
    expect(() => nativeResponseSchema.parse({ id: "r1", ok: false })).toThrow();
  });
});
