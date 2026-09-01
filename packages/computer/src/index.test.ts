import { describe, expect, it } from "vitest";
import { MockComputerController, NativeComputerController } from "./index";

describe("computer controllers", () => {
  it("records deterministic mock actions without touching the host", async () => {
    const computer = new MockComputerController();

    await computer.launchApp("Notepad");
    await computer.typeText({ text: "Hello", windowId: "mock-notepad-window" });

    expect(computer.state.typedText).toEqual(["Hello"]);
    expect(computer.state.actions.map((action) => action.method)).toEqual([
      "launchApp",
      "typeText",
    ]);
  });

  it("maps controller calls to the typed RPC protocol", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const controller = new NativeComputerController({
      request: async (method, params) => {
        calls.push({ method, params });
        return { ok: true, changed: true } as never;
      },
    });

    await controller.launchApp("Notepad", ["--test"]);
    await controller.clickElement({ windowId: "window-1", role: "Button", name: "Save" });

    expect(calls).toEqual([
      { method: "launchApp", params: { app: "Notepad", arguments: ["--test"] } },
      { method: "clickElement", params: { windowId: "window-1", role: "Button", name: "Save" } },
    ]);
  });
});
