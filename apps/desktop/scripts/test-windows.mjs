import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("test:windows must run on Windows; it is intentionally not part of the normal test suite.");
}

const here = dirname(fileURLToPath(import.meta.url));
const sidecar = process.env.OPENUSE_NATIVE_ENGINE_PATH
  ? resolve(process.env.OPENUSE_NATIVE_ENGINE_PATH)
  : resolve(here, "../../../native/windows/publish/OpenUse.WindowsController.exe");
if (!existsSync(sidecar)) throw new Error(`Windows sidecar not found: ${sidecar}. Run pnpm native:build first.`);

const child = spawn(sidecar, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const responses = [];
let sequence = 0;
let settled = false;
let childError;
let childExit;
child.once("error", (error) => {
  childError = error;
});
const exit = new Promise((resolveExit) => {
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
    resolveExit(childExit);
  });
});

lines.on("line", (line) => {
  try { responses.push(JSON.parse(line)); }
  catch { /* The request below will fail on timeout if the sidecar breaks stdout. */ }
});
child.stderr.on("data", () => undefined);

function nextResponse(predicate) {
  return new Promise((resolveResponse, reject) => {
    let interval;
    const deadline = setTimeout(() => {
      globalThis.clearInterval(interval);
      reject(new Error("Timed out waiting for the Windows sidecar response."));
    }, 5000);
    const check = () => {
      if (childError) {
        globalThis.clearTimeout(deadline);
        globalThis.clearInterval(interval);
        reject(new Error(`The Windows sidecar could not be started: ${childError.message}`));
        return;
      }
      if (childExit) {
        globalThis.clearTimeout(deadline);
        globalThis.clearInterval(interval);
        reject(new Error(`The Windows sidecar exited before responding (${childExit.code ?? "unknown"}).`));
        return;
      }
      const index = responses.findIndex(predicate);
      if (index < 0) return;
      globalThis.clearTimeout(deadline);
      globalThis.clearInterval(interval);
      resolveResponse(responses.splice(index, 1)[0]);
    };
    interval = globalThis.setInterval(check, 10);
    // Keep the polling simple and deterministic; the child is local stdio.
    check();
  });
}

async function raw(line, predicate = () => true) {
  child.stdin.write(`${line}\n`, "utf8");
  return nextResponse(predicate);
}

async function request(method, params) {
  const id = `windows-smoke-${++sequence}`;
  const response = await raw(JSON.stringify({ id, method, params }), (item) => item?.id === id);
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
}

try {
  const malformed = await raw("{not-json", (item) => item?.id === "unknown");
  if (malformed.ok || malformed.error?.code !== "INVALID_TOOL_INPUT") throw new Error("Malformed request was not rejected correctly.");

  const unknown = await raw(JSON.stringify({ id: "windows-smoke-unknown", method: "notARealMethod", params: {} }), (item) => item?.id === "windows-smoke-unknown");
  if (unknown.ok || unknown.error?.code !== "UNSUPPORTED_ACTION") throw new Error("Unknown method was not rejected correctly.");

  const windows = await request("listWindows", {});
  if (!Array.isArray(windows.windows)) throw new Error("listWindows did not return a windows array.");

  const invalidWindow = await raw(JSON.stringify({ id: "windows-smoke-invalid", method: "inspectWindow", params: { windowId: "0" } }), (item) => item?.id === "windows-smoke-invalid");
  if (invalidWindow.ok || invalidWindow.error?.code !== "WINDOW_NOT_FOUND") throw new Error("Invalid window ID was not rejected correctly.");

  const waited = await request("wait", { milliseconds: 50 });
  if (!waited.ok || waited.waitedMs !== 50) throw new Error("wait did not return its structured result.");

  const waitId = `windows-smoke-${++sequence}`;
  const inFlightWait = raw(JSON.stringify({ id: waitId, method: "wait", params: { milliseconds: 1000 } }), (item) => item?.id === waitId);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  const cancelId = `windows-smoke-${++sequence}`;
  const cancel = await raw(JSON.stringify({ id: cancelId, method: "cancel", params: { requestId: waitId } }), (item) => item?.id === cancelId);
  if (!cancel.ok || cancel.result?.cancelled !== true) throw new Error("The sidecar did not acknowledge cancellation.");
  const cancelled = await inFlightWait;
  if (cancelled.ok || cancelled.error?.code !== "TASK_CANCELLED") throw new Error("The in-flight wait was not cancelled.");
  const reused = await request("listWindows", {});
  if (!Array.isArray(reused.windows)) throw new Error("The sidecar was not reusable after cancellation.");

  child.stdin.end();
  const termination = await exit;
  if (termination.code !== 0) throw new Error(`The Windows sidecar did not shut down cleanly (${termination.code ?? termination.signal ?? "unknown"}).`);
  settled = true;
  process.stdout.write(`${JSON.stringify({ sidecar, protocol: "PASS", windows: windows.windows.length, malformed: "PASS", unknownMethod: "PASS", invalidWindow: "PASS", wait: "PASS", cancellation: "PASS", reuseAfterCancellation: "PASS", gracefulShutdown: "PASS" })}\n`);
} finally {
  if (!settled) {
    settled = true;
    child.kill();
  }
  lines.close();
}
