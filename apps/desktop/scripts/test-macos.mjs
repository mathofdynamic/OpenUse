import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("test:macos must run on macOS; GUI and native execution were not attempted.");

const here = dirname(fileURLToPath(import.meta.url));
const requirePermissions = process.argv.includes("--require-permissions");
const sidecar = process.env.OPENUSE_NATIVE_ENGINE_PATH
  ? resolve(process.env.OPENUSE_NATIVE_ENGINE_PATH)
  : resolve(here, "../../../native/macos/.build/release/OpenUseMacController");
if (!existsSync(sidecar)) throw new Error(`macOS controller not found: ${sidecar}. Run pnpm native:build:macos first.`);

const child = spawn(sidecar, [], { stdio: ["pipe", "pipe", "pipe"] });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const responses = [];
let sequence = 0;
let childError;
let childExit;
let settled = false;
child.once("error", (error) => { childError = error; });
const exit = new Promise((resolveExit) => child.once("exit", (code, signal) => { childExit = { code, signal }; resolveExit(childExit); }));
lines.on("line", (line) => { try { responses.push(JSON.parse(line)); } catch { /* nextResponse times out */ } });
child.stderr.on("data", () => undefined);

function nextResponse(predicate) {
  return new Promise((resolveResponse, reject) => {
    let interval;
    const deadline = setTimeout(() => { globalThis.clearInterval(interval); reject(new Error("Timed out waiting for the macOS controller response.")); }, 5000);
    const check = () => {
      if (childError) return finish(reject, new Error(`The macOS controller could not start: ${childError.message}`));
      if (childExit) return finish(reject, new Error(`The macOS controller exited before responding (${childExit.code ?? "unknown"}).`));
      const index = responses.findIndex(predicate);
      if (index < 0) return;
      const response = responses.splice(index, 1)[0];
      finish(resolveResponse, response);
    };
    interval = globalThis.setInterval(check, 10);
    check();
    function finish(callback, value) { globalThis.clearTimeout(deadline); globalThis.clearInterval(interval); callback(value); }
  });
}

async function raw(line, predicate = () => true) {
  child.stdin.write(`${line}\n`, "utf8");
  return nextResponse(predicate);
}

async function request(method, params) {
  const id = `macos-smoke-${++sequence}`;
  const response = await raw(JSON.stringify({ id, method, params }), (item) => item?.id === id);
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
}

try {
  const malformed = await raw("{not-json", (item) => item?.id === "unknown");
  if (malformed.ok || malformed.error?.code !== "INVALID_TOOL_INPUT") throw new Error("Malformed request was not rejected correctly.");
  const unknownId = `macos-smoke-${++sequence}`;
  const unknown = await raw(JSON.stringify({ id: unknownId, method: "notARealMethod", params: {} }), (item) => item?.id === unknownId);
  if (unknown.ok || unknown.error?.code !== "UNSUPPORTED_ACTION") throw new Error("Unknown method was not rejected correctly.");
  const apps = await request("listApps", {});
  const windows = await request("listWindows", {});
  if (!Array.isArray(apps.apps) || !Array.isArray(windows.windows)) throw new Error("Enumeration did not return arrays.");
  const invalidId = `macos-smoke-${++sequence}`;
  const invalidWindow = await raw(JSON.stringify({ id: invalidId, method: "inspectWindow", params: { windowId: "mac-window-invalid" } }), (item) => item?.id === invalidId);
  if (invalidWindow.ok || !["WINDOW_NOT_FOUND", "ACCESSIBILITY_PERMISSION_REQUIRED"].includes(invalidWindow.error?.code)) throw new Error("Invalid window ID was not rejected correctly.");
  const selfTest = await request("selfTest", {});
  if (selfTest.monitorCount < 1 || !Array.isArray(selfTest.monitors)) throw new Error(`Native self-test did not return monitor data: ${selfTest.detail ?? "unknown failure"}`);
  for (const capability of ["windowEnumerationAvailable", "screenEnumerationAvailable", "dpiAvailable", "inputApisAvailable"]) {
    if (selfTest[capability] !== true) throw new Error(`Native self-test reported ${capability}=false.`);
  }
  if (requirePermissions) {
    for (const capability of ["uiAutomationAvailable", "screenshotAvailable"]) {
      if (selfTest[capability] !== true) throw new Error(`Native self-test reported ${capability}=false; grant macOS privacy permissions before qualification.`);
    }
  }
  const waited = await request("wait", { milliseconds: 50 });
  if (!waited.ok || waited.waitedMs !== 50) throw new Error("wait did not return its structured result.");
  const waitId = `macos-smoke-${++sequence}`;
  const inFlight = raw(JSON.stringify({ id: waitId, method: "wait", params: { milliseconds: 1000 } }), (item) => item?.id === waitId);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  const cancelId = `macos-smoke-${++sequence}`;
  const cancel = await raw(JSON.stringify({ id: cancelId, method: "cancel", params: { requestId: waitId } }), (item) => item?.id === cancelId);
  if (!cancel.ok || cancel.result?.cancelled !== true) throw new Error("The controller did not acknowledge cancellation.");
  const cancelled = await inFlight;
  if (cancelled.ok || cancelled.error?.code !== "TASK_CANCELLED") throw new Error("The in-flight wait was not cancelled.");
  const reused = await request("listWindows", {});
  if (!Array.isArray(reused.windows)) throw new Error("The controller was not reusable after cancellation.");
  child.stdin.end();
  const termination = await exit;
  if (termination.code !== 0) throw new Error(`The controller did not shut down cleanly (${termination.code ?? termination.signal ?? "unknown"}).`);
  settled = true;
  process.stdout.write(`${JSON.stringify({ sidecar, protocol: "PASS", apps: apps.apps.length, windows: windows.windows.length, selfTest: requirePermissions ? "PASS" : "RESPONDED", accessibilityPermission: selfTest.accessibilityPermission, screenRecordingPermission: selfTest.screenRecordingPermission, monitorCount: selfTest.monitorCount, malformed: "PASS", unknownMethod: "PASS", invalidWindow: "PASS", wait: "PASS", cancellation: "PASS", reuseAfterCancellation: "PASS", gracefulShutdown: "PASS" })}\n`);
} finally {
  if (!settled) { settled = true; child.kill(); }
  lines.close();
}
