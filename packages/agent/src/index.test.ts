import { describe, expect, it } from "vitest";
import { MockComputerController } from "@openuse/computer";
import { InMemoryPermissionStore, PermissionEngine } from "@openuse/permissions";
import type { ModelProvider, AgentStepOptions, AgentStepResult } from "@openuse/ai";
import type { ModelCapabilities } from "@openuse/shared";
import { ComputerUseAgent } from "./index";

function assistantTool(toolName: string, toolCallId: string, input: unknown): AgentStepResult {
  return {
    responseMessages: [
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId, toolName, input }],
      },
    ] as never,
    toolCalls: [{ toolCallId, toolName, input }],
    finishReason: "tool-calls",
    text: "",
  };
}

class ScriptedProvider implements ModelProvider {
  readonly id = "test";
  readonly displayName = "Test provider";
  private index = 0;
  readonly calls: AgentStepOptions[] = [];
  readonly script: AgentStepResult[];

  constructor(script: AgentStepResult[]) {
    this.script = script;
  }

  getCapabilities(_modelId: string): ModelCapabilities {
    return { toolCalling: true, vision: true };
  }

  async generateAgentStep(options: AgentStepOptions): Promise<AgentStepResult> {
    this.calls.push(options);
    return this.script[this.index++] ?? {
      responseMessages: [],
      toolCalls: [],
      finishReason: "stop",
      text: "done",
    };
  }
}

describe("ComputerUseAgent", () => {
  it("executes a deterministic tool loop serially and finishes", async () => {
    const provider = new ScriptedProvider([
      assistantTool("computer_launch_app", "1", { app: "Notepad" }),
      assistantTool("computer_inspect_window", "2", { windowId: "mock-notepad-window" }),
      assistantTool("computer_click_element", "3", { windowId: "mock-notepad-window", role: "Edit", name: "Text editor" }),
      assistantTool("computer_type_text", "4", { text: "Hello from OpenUse", windowId: "mock-notepad-window", role: "Edit", name: "Text editor" }),
      assistantTool("computer_finish", "5", { summary: "Notepad contains the requested text." }),
    ]);
    const computer = new MockComputerController();
    const permissions = new PermissionEngine(new InMemoryPermissionStore(), {
      request: async () => "deny",
    });
    const events: unknown[] = [];
    const agent = new ComputerUseAgent(provider, computer, permissions);
    const result = await agent.run({
      taskId: "test-task",
      command: "Open Notepad and type Hello from OpenUse",
      modelId: "openai/gpt-5.4",
      abortSignal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });

    expect(result).toMatchObject({ status: "completed", actionCount: 5 });
    expect(computer.state.typedText).toEqual(["Hello from OpenUse"]);
    expect(computer.state.actions.map((action) => action.method)).toEqual([
      "launchApp",
      "wait",
      "listWindows",
      "inspectWindow",
      "listWindows",
      "inspectWindow",
      "listWindows",
      "inspectWindow",
      "clickElement",
      "inspectWindow",
      "listWindows",
      "inspectWindow",
      "typeText",
      "inspectWindow",
    ]);
    expect(events.some((event) => (event as { type?: string }).type === "action.completed")).toBe(true);
  });

  it("stops before a provider step when cancelled", async () => {
    const provider = new ScriptedProvider([]);
    const computer = new MockComputerController();
    const permissions = new PermissionEngine(new InMemoryPermissionStore(), { request: async () => "deny" });
    const abort = new AbortController();
    abort.abort();
    const agent = new ComputerUseAgent(provider, computer, permissions);
    await expect(agent.run({
      taskId: "cancelled-task",
      command: "Do not run",
      modelId: "openai/gpt-5.4",
      abortSignal: abort.signal,
      onEvent: () => undefined,
    })).rejects.toMatchObject({ code: "TASK_CANCELLED" });
    expect(provider.calls).toHaveLength(0);
  });

  it("requests a fresh observation after a stale window target instead of replaying blindly", async () => {
    const provider = new ScriptedProvider([
      assistantTool("computer_click_element", "stale-1", { windowId: "gone-window", role: "Button", name: "Save" }),
      assistantTool("computer_finish", "stale-2", { summary: "Stopped after refreshing the UI state." }),
    ]);
    const computer = new MockComputerController();
    const permissions = new PermissionEngine(new InMemoryPermissionStore(), { request: async () => "deny" });
    const agent = new ComputerUseAgent(provider, computer, permissions);

    const result = await agent.run({
      taskId: "stale-task",
      command: "Click Save",
      modelId: "openai/gpt-5.4",
      abortSignal: new AbortController().signal,
      onEvent: () => undefined,
    });

    expect(result).toMatchObject({ status: "completed", actionCount: 2 });
    expect(provider.calls[1]?.messages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("computer_inspect_window"))).toBe(true);
    expect(computer.state.actions.map((action) => action.method)).toEqual(["listWindows"]);
  });
});
