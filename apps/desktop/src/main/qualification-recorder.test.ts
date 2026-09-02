import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QualificationRecorder } from "./qualification-recorder";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("qualification recorder", () => {
  it("persists metrics while omitting commands, values, and screenshot payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openuse-qualification-"));
    directories.push(directory);
    const recorder = new QualificationRecorder({ enabled: true, directory, runId: "test-run" });

    recorder.record({
      type: "task.started",
      taskId: "task-1",
      command: "type a private value",
      modelId: "openai/gpt-5.4",
      capabilities: { toolCalling: true, vision: true },
      at: "2026-09-02T00:00:00.000Z",
    });
    recorder.record({
      type: "qualification.debug",
      debug: {
        taskId: "task-1",
        step: 1,
        actionCount: 1,
        tool: "computer_type_text",
        retryCount: 0,
        result: "success",
        elements: [{
          id: "el_1",
          role: "Edit",
          name: "Editor",
          className: "Edit",
          bounds: { x: 0, y: 0, width: 10, height: 10 },
          enabled: true,
          offscreen: false,
          supportedPatterns: ["Value"],
          value: "private value",
        }],
      },
      at: "2026-09-02T00:00:01.000Z",
    });
    recorder.record({
      type: "action.completed",
      taskId: "task-1",
      actionId: "action-1",
      durationMs: 12,
      telemetry: { interactionMethod: "accessibility-native", retryCount: 0 },
      at: "2026-09-02T00:00:01.000Z",
    });

    const events = await readFile(join(directory, "events.jsonl"), "utf8");
    expect(events).toContain("accessibility-native");
    expect(events).toContain("commandLength");
    expect(events).not.toContain("type a private value");
    expect(events).not.toContain("private value");
  });
});
