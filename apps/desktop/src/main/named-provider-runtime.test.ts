import { afterEach, describe, expect, it } from "vitest";
import { ComputerUseAgent } from "@openuse/agent";
import { MockComputerController } from "@openuse/computer";
import { InMemoryPermissionStore, PermissionEngine } from "@openuse/permissions";
import { OpenUseMcpBridge } from "./named-provider-mcp";
import { extractNamedProviderVersion, parseCodexModels, parseCodexQuota, parseNamedProviderAuthentication, parseNamedProviderUsage, parseOpenCodeModels, providerDisplayName, providerSetupCommands } from "./named-provider-runtime";

const openBridges: OpenUseMcpBridge[] = [];

afterEach(async () => {
  await Promise.all(openBridges.splice(0).map((bridge) => bridge.close()));
});

describe("named subscription runtime helpers", () => {
  it("exposes the documented local install and sign-in commands", () => {
    expect(providerDisplayName("codex")).toBe("Codex");
    expect(providerSetupCommands("claude")).toEqual({
      install: "npm install -g @anthropic-ai/claude-code",
      login: "claude auth login",
    });
    expect(providerSetupCommands("opencode").login).toBe("opencode auth login");
  });

  it("parses provider versions without retaining provider output", () => {
    expect(extractNamedProviderVersion("codex", "codex-cli 0.154.0\n")).toBe("0.154.0");
    expect(extractNamedProviderVersion("claude", "2.1.202 (Claude Code)\n")).toBe("2.1.202");
    expect(extractNamedProviderVersion("opencode", "not a version")).toBeUndefined();
  });

  it("extracts only bounded token usage from structured provider output", () => {
    expect(parseNamedProviderUsage('{"type":"result","usage":{"input_tokens":1200,"output_tokens":"340"}}')).toEqual({ inputTokens: 1200, outputTokens: 340 });
    expect(parseNamedProviderUsage("not json")).toBeUndefined();
    expect(parseNamedProviderUsage('{"usage":{"input_tokens":-1}}')).toBeUndefined();
  });

  it("fails closed when an installed provider reports no authenticated account", () => {
    expect(parseNamedProviderAuthentication("opencode", { code: 0, stdout: "", stderr: "" })).toBe(false);
    expect(parseNamedProviderAuthentication("opencode", { code: 0, stdout: "No credentials stored", stderr: "" })).toBe(false);
    expect(parseNamedProviderAuthentication("codex", { code: 0, stdout: "Logged in using ChatGPT", stderr: "" })).toBe(true);
    expect(parseNamedProviderAuthentication("claude", { code: 0, stdout: '{"loggedIn":true,"authMethod":"oauth"}', stderr: "" })).toBe(true);
    expect(parseNamedProviderAuthentication("claude", { code: 0, stdout: '{"loggedIn":false}', stderr: "" })).toBe(false);
  });

  it("parses Codex live models and preserves provider-reported reasoning support", () => {
    const models = parseCodexModels({ data: [{ model: "gpt-6-astra", displayName: "GPT-6 Astra", isDefault: true, inputModalities: ["text", "image"], supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }, { reasoningEffort: "ultra" }] }] });
    expect(models[0]).toMatchObject({ id: "gpt-6-astra", label: "GPT-6 Astra", isDefault: true });
    expect(models[0]?.capabilities).toMatchObject({ toolCalling: true, vision: true, reasoning: true, reasoningEfforts: ["provider-default", "low", "high"] });
  });

  it("does not claim configurable reasoning when Codex omits reasoning metadata", () => {
    const models = parseCodexModels({ data: [{ model: "gpt-5.5", inputModalities: ["text", "image"] }] });
    expect(models[0]?.capabilities).toMatchObject({ reasoning: false, reasoningEfforts: ["provider-default"] });
  });

  it("maps Codex primary and secondary windows to remaining 5-hour and weekly capacity", () => {
    const quota = parseCodexQuota({ planType: "plus", rateLimits: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1789122974 }, secondary: { usedPercent: 44, windowDurationMins: 10080, resetsAt: 1789450487 } } }, "2026-09-11T00:00:00.000Z");
    expect(quota?.windows).toEqual([
      expect.objectContaining({ id: "primary", label: "5-hour", remainingPercent: 80, windowDurationMins: 300 }),
      expect.objectContaining({ id: "secondary", label: "Weekly", remainingPercent: 56, windowDurationMins: 10080 }),
    ]);
  });

  it("keeps OpenCode model IDs selectable without inventing provider pricing", () => {
    const models = parseOpenCodeModels("Available models:\nopenai/gpt-5\nanthropic/claude-sonnet\n", "anthropic/claude-sonnet");
    expect(models.map((model) => model.id)).toEqual(["openai/gpt-5", "anthropic/claude-sonnet"]);
    expect(models[1]?.pricing).toBeUndefined();
  });

  it("parses OpenCode verbose metadata for capabilities, context, and reasoning variants", () => {
    const models = parseOpenCodeModels(`openai/gpt-5\n${JSON.stringify({
      name: "GPT 5",
      attachment: true,
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      limit: { context: 128000, output: 16384 },
      variants: { none: {}, low: {}, high: {}, max: {} },
    }, null, 2)}\n`);
    expect(models[0]).toMatchObject({ id: "openai/gpt-5", label: "GPT 5", contextWindow: 128000, maxOutputTokens: 16384 });
    expect(models[0]?.capabilities).toMatchObject({ toolCalling: true, vision: true, reasoning: true, reasoningEfforts: ["provider-default", "none", "low", "high"] });
    expect(models[0]?.pricing).toBeUndefined();
  });
});

describe("OpenUse MCP bridge", () => {
  it("requires the per-task bearer token and delegates only guarded tools", async () => {
    const computer = new MockComputerController();
    const agent = new ComputerUseAgent(undefined, computer, new PermissionEngine(new InMemoryPermissionStore(), { request: async () => "allow-once" }));
    const events: Array<{ type: string }> = [];
    const bridge = new OpenUseMcpBridge({
      taskId: "mcp-test",
      command: "list apps",
      modelId: "codex:default",
      abortSignal: new AbortController().signal,
      agent,
      onEvent: (event) => events.push({ type: event.type }),
    });
    openBridges.push(bridge);
    const handle = await bridge.start();

    const unauthorized = await fetch(handle.url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(unauthorized.status).toBe(401);

    const listResponse = await fetch(handle.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${handle.bearerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const listed = await listResponse.json() as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toContain("computer_list_apps");
    expect(listed.result.tools.map((tool) => tool.name)).not.toContain("shell");

    const toolResponse = await fetch(handle.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${handle.bearerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "computer_list_apps", arguments: {} } }),
    });
    const toolResult = await toolResponse.json() as { result: { isError: boolean; content: Array<{ type: string; text?: string }> } };
    expect(toolResult.result.isError).toBe(false);
    expect(toolResult.result.content[0]?.type).toBe("text");
    expect(events.map((event) => event.type)).toEqual(["action.started", "action.completed"]);
  });

  it("records completion only through the guarded computer_finish tool", async () => {
    const agent = new ComputerUseAgent(undefined, new MockComputerController(), new PermissionEngine(new InMemoryPermissionStore(), { request: async () => "allow-once" }));
    const bridge = new OpenUseMcpBridge({
      taskId: "mcp-finish-test",
      command: "finish",
      modelId: "claude:default",
      abortSignal: new AbortController().signal,
      agent,
      onEvent: () => undefined,
    });
    openBridges.push(bridge);
    const handle = await bridge.start();
    const response = await fetch(handle.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${handle.bearerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "computer_finish", arguments: { summary: "Verified." } } }),
    });
    expect((await response.json() as { result: { isError: boolean } }).result.isError).toBe(false);
    expect(bridge.completedSummary).toBe("Verified.");
  });
});
