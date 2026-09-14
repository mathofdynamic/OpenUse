import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeEngineProcess, resolveNativeEnginePath, type NativeProcessOptions } from "./native-process";

const temporaryDirectories: string[] = [];
const engines: NativeEngineProcess[] = [];
const originalEnginePath = process.env.OPENUSE_NATIVE_ENGINE_PATH;

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.shutdown();
  if (originalEnginePath === undefined) delete process.env.OPENUSE_NATIVE_ENGINE_PATH;
  else process.env.OPENUSE_NATIVE_ENGINE_PATH = originalEnginePath;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fakeSidecar(body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openuse-native-process-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "sidecar.sh");
  await writeFile(path, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(path, 0o700);
  process.env.OPENUSE_NATIVE_ENGINE_PATH = path;
  return path;
}

function createEngine(platform: "win32" | "darwin" = "win32"): NativeEngineProcess {
  const engine = new NativeEngineProcess({
    platform,
    isPackaged: false,
    appPath: "/tmp/openuse-test-app",
    resourcesPath: "/tmp/openuse-test-resources",
  });
  engines.push(engine);
  return engine;
}

function pathOptions(platform: "win32" | "darwin", isPackaged: boolean): NativeProcessOptions {
  return {
    platform,
    isPackaged,
    appPath: isPackaged ? "/Applications/OpenUse.app/Contents/Resources/app.asar" : "/workspace/apps/desktop",
    resourcesPath: isPackaged ? "/Applications/OpenUse.app/Contents/Resources" : "/workspace/resources",
  };
}

describe("native controller path resolution", () => {
  it("resolves the embedded macOS controller from the app executables directory", () => {
    expect(resolveNativeEnginePath(pathOptions("darwin", true))).toBe("/Applications/OpenUse.app/Contents/MacOS/OpenUseMacController");
  });

  it("resolves the repository macOS controller during development", () => {
    expect(resolveNativeEnginePath(pathOptions("darwin", false))).toBe("/workspace/native/macos/.build/release/OpenUseMacController");
  });

  it("preserves Windows development and packaged paths", () => {
    expect(resolveNativeEnginePath(pathOptions("win32", false))).toBe("/workspace/native/windows/publish/OpenUse.WindowsController.exe");
    expect(resolveNativeEnginePath(pathOptions("win32", true))).toBe("/Applications/OpenUse.app/Contents/Resources/native/windows/OpenUse.WindowsController.exe");
  });

  it("honors an explicit sidecar path for diagnostics", () => {
    expect(resolveNativeEnginePath(pathOptions("darwin", false), "/tmp/test-controller")).toBe("/tmp/test-controller");
  });

  it("keeps the packaged controller path authoritative", () => {
    const saved = process.env.OPENUSE_NATIVE_ENGINE_PATH;
    process.env.OPENUSE_NATIVE_ENGINE_PATH = "/tmp/external-controller";
    try {
      expect(resolveNativeEnginePath(pathOptions("darwin", true))).toBe("/Applications/OpenUse.app/Contents/MacOS/OpenUseMacController");
    } finally {
      if (saved === undefined) delete process.env.OPENUSE_NATIVE_ENGINE_PATH;
      else process.env.OPENUSE_NATIVE_ENGINE_PATH = saved;
    }
  });
});

describe("native sidecar process boundary", () => {
  it("starts the configured macOS controller through the same protocol boundary", async () => {
    await fakeSidecar("IFS= read -r request\nprintf '%s\\n' '{\"id\":\"native-1\",\"ok\":true,\"result\":{\"windows\":[]}}'");
    const engine = createEngine("darwin");

    await expect(engine.request("listWindows", {})).resolves.toEqual({ windows: [] });
    expect(engine.status.platform).toBe("darwin");
    expect(engine.status.state).toBe("ready");
    expect(engine.status.detail).toContain("macOS");
  });

  it("reports an unavailable executable without waiting on a request timeout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openuse-native-process-"));
    temporaryDirectories.push(directory);
    process.env.OPENUSE_NATIVE_ENGINE_PATH = join(directory, "missing-sidecar");
    const engine = createEngine();

    await expect(engine.request("listWindows", {})).rejects.toMatchObject({ code: "NATIVE_ENGINE_OFFLINE" });
  });

  it("turns malformed stdout into IPC_ERROR and marks the sidecar offline", async () => {
    await fakeSidecar("IFS= read -r request\nprintf 'not-json\\n'");
    const engine = createEngine();

    await expect(engine.request("listWindows", {})).rejects.toMatchObject({ code: "IPC_ERROR" });
    expect(engine.status.state).toBe("offline");
  });

  it("turns an unexpected child exit into NATIVE_ENGINE_OFFLINE", async () => {
    await fakeSidecar("exit 9");
    const engine = createEngine();

    await expect(engine.request("listWindows", {})).rejects.toMatchObject({ code: "NATIVE_ENGINE_OFFLINE" });
    expect(engine.status.state).toBe("offline");
    expect(engine.status.canStart).toBe(true);
  });

  it("cancels an in-flight request without waiting for the native timeout", async () => {
    await fakeSidecar("while IFS= read -r request; do sleep 1; done");
    const engine = createEngine();
    const abort = new AbortController();
    const request = engine.request("listWindows", {}, abort.signal);

    await new Promise((resolve) => setTimeout(resolve, 100));
    abort.abort();

    await expect(request).rejects.toMatchObject({ code: "TASK_CANCELLED" });
    await engine.stop();
    expect(engine.status.state).toBe("ready");
  });

  it("keeps a healthy sidecar reusable after cancelling a request", async () => {
    await fakeSidecar(`
first=1
while IFS= read -r request; do
  case "$request" in
    *'"method":"cancel"'*) printf '%s\\n' '{"id":"native-cancel-2","ok":true,"result":{"ok":true,"cancelled":true}}' ;;
    *'"method":"listWindows"'*)
      if [ "$first" = 1 ]; then first=0; else printf '%s\\n' '{"id":"native-3","ok":true,"result":{"windows":[]}}' ; fi
      ;;
  esac
done`);
    const engine = createEngine();
    const abort = new AbortController();
    const request = engine.request("listWindows", {}, abort.signal);

    await new Promise((resolve) => setTimeout(resolve, 100));
    abort.abort();
    await expect(request).rejects.toMatchObject({ code: "TASK_CANCELLED" });

    await expect(engine.request("listWindows", {})).resolves.toEqual({ windows: [] });
    expect(engine.status.state).toBe("ready");
    expect(engine.status.protocol).toBe("json-lines/v1");
    expect(engine.status.lastAction).toBe("listWindows");
    expect(engine.status.lastHeartbeatAt).toBeDefined();
  });
});
