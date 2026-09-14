import { describe, expect, it } from "vitest";
import {
  InMemoryPermissionStore,
  PermissionEngine,
  classifyActionRisk,
  defaultPermissionRecords,
  isCredentialTarget,
} from "./index";

describe("application permissions", () => {
  it("seeds the default permissions", () => {
    const records = defaultPermissionRecords();
    expect(records.find((record) => record.appName === "Notepad")?.level).toBe("ALLOW");
    expect(records.find((record) => record.appName === "Password Manager")?.level).toBe("DENY");
  });

  it("prompts for an unknown app and keeps allow-once in the session", async () => {
    const store = new InMemoryPermissionStore([]);
    let prompts = 0;
    const engine = new PermissionEngine(store, {
      request: async () => {
        prompts += 1;
        return "allow-once";
      },
    });
    const input = {
      appName: "Paint",
      tool: "computer_launch_app",
      actionSummary: "Open Paint",
      risk: "interaction" as const,
      reason: "OpenUse is requesting control of this application.",
    };
    await engine.authorize(input, new AbortController().signal);
    await engine.authorize(input, new AbortController().signal);
    expect(prompts).toBe(1);
  });

  it("denies an app before native execution", async () => {
    const engine = new PermissionEngine(new InMemoryPermissionStore([
      { appName: "Password Manager", level: "DENY", updatedAt: new Date().toISOString() },
    ]), { request: async () => "allow-once" });
    await expect(engine.authorize({
      appName: "Password Manager",
      tool: "computer_focus_window",
      actionSummary: "Focus Password Manager",
      risk: "interaction",
      reason: "control",
    }, new AbortController().signal)).rejects.toMatchObject({
      code: "APP_NOT_ALLOWED",
    });
  });

  it("classifies high-risk actions independently of model claims", () => {
    expect(classifyActionRisk("computer_click_element", { name: "Submit order" })).toBe("sensitive");
    expect(classifyActionRisk("computer_press_key", { key: "DELETE" })).toBe("destructive");
    expect(classifyActionRisk("computer_type_text", { role: "Password" })).toBe("sensitive");
    expect(classifyActionRisk("computer_launch_app", { appName: "Settings" })).toBe("sensitive");
  });

  it("recognizes credential controls by common compound field names", () => {
    expect(isCredentialTarget("Edit", "PasswordBox")).toBe(true);
    expect(isCredentialTarget("Edit", "Password field")).toBe(true);
  });

  it("blocks known credential applications before prompting", async () => {
    const engine = new PermissionEngine(new InMemoryPermissionStore([]), { request: async () => "allow-once" });

    await expect(engine.authorize({
      appName: "1Password",
      tool: "computer_launch_app",
      actionSummary: "Open 1Password",
      risk: "interaction",
      reason: "control",
    }, new AbortController().signal)).rejects.toMatchObject({ code: "APP_NOT_ALLOWED" });
  });

  it("matches persisted permissions by stable application identity", async () => {
    const store = new InMemoryPermissionStore([
      {
        appName: "Calculator",
        appIdentity: "win32:calculatorapp:applicationframewindow",
        level: "DENY",
        updatedAt: new Date().toISOString(),
      },
    ]);
    let prompts = 0;
    const engine = new PermissionEngine(store, {
      request: async (request) => {
        prompts += 1;
        expect(request.appIdentity).toBe("win32:calculatorapp:applicationframewindow");
        return "allow-once";
      },
    });

    await expect(engine.authorize({
      appName: "Calculator",
      appIdentity: "win32:calculatorapp:applicationframewindow",
      tool: "computer_focus_window",
      actionSummary: "Focus Calculator",
      risk: "interaction",
      reason: "control",
    }, new AbortController().signal)).rejects.toMatchObject({ code: "APP_NOT_ALLOWED" });

    expect(prompts).toBe(0);
  });

  it("keeps allow-once usable across a launch name and its discovered window identity", async () => {
    const engine = new PermissionEngine(new InMemoryPermissionStore([]), {
      request: async () => "allow-once",
    });
    await engine.authorize({
      appName: "Paint",
      tool: "computer_launch_app",
      actionSummary: "Open Paint",
      risk: "interaction",
      reason: "control",
    }, new AbortController().signal);
    await expect(engine.authorize({
      appName: "Paint",
      appIdentity: "win32:mspaint:paintwindow",
      tool: "computer_inspect_window",
      actionSummary: "Inspect Paint",
      risk: "read",
      reason: "inspect",
    }, new AbortController().signal)).resolves.toBeUndefined();
  });
});
