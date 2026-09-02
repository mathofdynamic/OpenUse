import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioDirectory = join(repositoryRoot, "qualification", "scenarios");
const outputRoot = join(repositoryRoot, ".openuse", "qualification");
const skipPreflight = process.argv.includes("--skip-preflight");
const taskTimeoutMs = 180_000;
const scenarios = ["macos-textedit-typing.json", "macos-calculator.json", "macos-textedit-save-as.json"].map((file) => readScenario(file));

if (process.platform !== "darwin") {
  console.error("qualify:macos must run on macOS. No GUI qualification was attempted.");
  process.exit(1);
}

const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const runDirectory = join(outputRoot, runId);
mkdirSync(runDirectory, { recursive: true });
const eventsPath = join(runDirectory, "events.jsonl");
const reportPath = join(runDirectory, "report.md");
const resultsPath = join(runDirectory, "results.json");
const input = createInterface({ input: stdin, output: stdout });
const resultDocument = {
  version: 1,
  platform: "darwin",
  runId,
  startedAt: new Date().toISOString(),
  finishedAt: undefined,
  preflight: skipPreflight ? "SKIPPED_BY_OPERATOR" : "PENDING",
  environment: readEnvironment(),
  scenarios: scenarios.map((scenario) => ({ id: scenario.id, title: scenario.title, expectedOutcome: scenario.expectedOutcome, repeatTarget: scenario.repeatCount, attempts: [], successes: 0, successRate: 0 })),
  manualChecks: manualCheckDefinitions().map((check) => ({ ...check, status: "NOT_TESTED" })),
  overallStatus: "INCOMPLETE",
};

let child;
let childError;
let childExit;

try {
  if (!skipPreflight) {
    console.log("Running the macOS preflight before opening the qualification harness…");
    const preflight = spawnSync("pnpm", ["verify:macos"], { cwd: repositoryRoot, stdio: "inherit" });
    if (preflight.status !== 0 || preflight.error) {
      resultDocument.preflight = "FAILED";
      throw new Error("macOS preflight failed. Grant the required privacy permissions and fix the failed check before GUI qualification.");
    }
    resultDocument.preflight = "PASS";
  }

  console.log(`\nQualification run: ${runId}`);
  console.log(`Evidence directory: ${runDirectory}`);
  console.log("Configure a compatible Gateway model and key in OpenUse Settings before continuing.");
  console.log("The harness displays goals only; it never injects a click sequence or declares a task successful on its own.\n");
  child = spawn(process.execPath, [resolve(repositoryRoot, "apps/desktop", "scripts", "dev-qualify.mjs")], {
    cwd: resolve(repositoryRoot, "apps/desktop"),
    env: { ...process.env, OPENUSE_QUALIFICATION_MODE: "1", OPENUSE_QUALIFICATION_DIR: runDirectory, OPENUSE_QUALIFICATION_RUN_ID: runId },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.once("error", (error) => { childError = error; });
  child.once("exit", (code, signal) => { childExit = { code, signal }; });
  await delay(4000);
  if (childError) throw new Error(`The qualification desktop could not start: ${childError.message}`);
  if (childExit) throw new Error(`The qualification desktop exited before testing (${childExit.code ?? childExit.signal ?? "unknown"}).`);

  await input.question("When the OpenUse window is ready and Settings are configured, press Enter to begin: ");
  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const documentScenario = resultDocument.scenarios[scenarioIndex];
    for (let attempt = 1; attempt <= scenario.repeatCount; attempt += 1) {
      await runAttempt(scenario, documentScenario, attempt);
      writeEvidence(resultDocument);
    }
  }

  console.log("\nManual reliability checks");
  console.log("These checks are operator-confirmed and are never inferred from a button click or stale state.");
  for (const check of resultDocument.manualChecks) {
    let answer = normalizeCheck(await input.question(`\n${check.title}\n${check.instructions}\nEnter PASS, FAIL, or SKIP: `));
    if (check.id === "stop-restart") {
      const latencyInput = await input.question("Observed cancellation latency in milliseconds, or leave blank if it was not measurable: ");
      const cancellationLatencyMs = parseNonNegativeInteger(latencyInput);
      const sidecarState = normalizeSidecarState(await input.question("Controller state after Stop (CONNECTED, OFFLINE, or UNKNOWN): "));
      const secondTask = normalizeCheck(await input.question("Did the immediately started second task succeed? Enter PASS or FAIL: "));
      check.metrics = { cancellationLatencyMs, sidecarState, secondTaskSuccess: secondTask === "PASS" };
      if (answer === "PASS" && (sidecarState !== "CONNECTED" || secondTask !== "PASS")) answer = "FAIL";
      if (answer === "PASS" && latencyInput.trim() !== "" && cancellationLatencyMs === undefined) answer = "FAIL";
    }
    check.status = answer === "PASS" || answer === "FAIL" ? answer : "NOT_TESTED";
    check.operatorConfirmed = answer === "PASS" || answer === "FAIL";
    check.notApplicable = check.id === "multi-monitor" && answer === "SKIP" && resultDocument.environment.monitorCount === 1;
    if (check.notApplicable) check.note = "Only one monitor was detected by the native self-test.";
    const observation = latestQualificationObservation();
    if (observation) check.observation = observation;
    writeEvidence(resultDocument);
  }
} catch (error) {
  resultDocument.failure = error instanceof Error ? error.message : "Qualification harness stopped unexpectedly.";
  console.error(`\nQualification stopped: ${resultDocument.failure}`);
} finally {
  resultDocument.finishedAt = new Date().toISOString();
  resultDocument.overallStatus = overallStatus(resultDocument);
  writeEvidence(resultDocument);
  input.close();
  await stopChild(child);
}

if (resultDocument.overallStatus !== "QUALIFIED") process.exitCode = 1;

async function runAttempt(scenario, documentScenario, attempt) {
  const baseline = readEvents().length;
  console.log(`\nScenario ${scenario.title} — run ${attempt}/${scenario.repeatCount}`);
  console.log(`Goal: ${scenario.task}`);
  console.log(`Expected visible outcome: ${scenario.expectedOutcome}`);
  console.log("Enter this exact goal in OpenUse. Do not manually operate the target app except for permission decisions.");
  await input.question("Press Enter after OpenUse reaches Completed, Stopped, or Error: ");
  let outcome = await waitForTask(baseline, taskTimeoutMs);
  if (!outcome.finished) {
    console.log("No terminal event was observed. Stop the task in OpenUse, then press Enter so the harness can observe cancellation.");
    await input.question("");
    outcome = await waitForTask(baseline, 20_000);
  }
  const operatorAnswer = normalizeCheck(await input.question("Did a fresh visible UI observation confirm the expected outcome? Enter PASS or FAIL: "));
  const attemptRecord = makeAttemptRecord(scenario, attempt, outcome, operatorAnswer);
  documentScenario.attempts.push(attemptRecord);
  documentScenario.successes = documentScenario.attempts.filter((item) => item.success).length;
  documentScenario.successRate = documentScenario.attempts.length === 0 ? 0 : documentScenario.successes / documentScenario.attempts.length;
  console.log(`Recorded ${attemptRecord.success ? "PASS" : "FAIL"}: ${attemptRecord.failureReason ?? "operator-confirmed and runtime-completed"}`);
  if (!outcome.finished) throw new Error(`Scenario ${scenario.id} did not reach a terminal runtime event; qualification stopped to avoid overlapping tasks.`);
}

function makeAttemptRecord(scenario, attempt, outcome, operatorAnswer) {
  const events = outcome.events;
  const started = outcome.started;
  const finished = outcome.finished;
  const actionEvents = events.filter((event) => event.taskId === started?.taskId && (event.type === "action.completed" || event.type === "action.failed"));
  const methods = actionEvents.map((event) => event.telemetry?.interactionMethod).filter(Boolean);
  const latestDebug = events.filter((event) => event.type === "qualification.debug" && event.debug.taskId === started?.taskId).at(-1)?.debug;
  const capabilities = started?.capabilities;
  const runtimeCompleted = finished?.status === "completed";
  const capabilityQualified = capabilities?.toolCalling === true && capabilities?.vision === true;
  let failureReason;
  if (!started) failureReason = "NO_TASK_STARTED_EVENT";
  else if (!finished) failureReason = "NO_TASK_FINISHED_EVENT";
  else if (!capabilityQualified) failureReason = "MODEL_UNSUPPORTED";
  else if (!runtimeCompleted) failureReason = finished.errorCode ?? `RUNTIME_${String(finished.status).toUpperCase()}`;
  else if (operatorAnswer !== "PASS") failureReason = "OPERATOR_DID_NOT_CONFIRM_VISIBLE_OUTCOME";
  return {
    scenarioId: scenario.id,
    attempt,
    model: started?.modelId ?? "UNKNOWN",
    capabilities: capabilities ?? null,
    success: runtimeCompleted && capabilityQualified && operatorAnswer === "PASS",
    runtimeCompleted,
    operatorConfirmed: operatorAnswer === "PASS",
    taskId: started?.taskId,
    actionCount: finished?.actionCount ?? events.filter((event) => event.type === "action.started").length,
    accessibilityNativeActions: methods.filter((method) => method === "accessibility-native").length,
    elementCoordinateFallbacks: methods.filter((method) => method === "element-coordinate").length,
    visionCoordinateFallbacks: methods.filter((method) => method === "vision-coordinate").length,
    coordinateInputActions: methods.filter((method) => method === "coordinate-input").length,
    keyboardInputActions: methods.filter((method) => method === "keyboard-input").length,
    retries: actionEvents.reduce((total, event) => total + (event.telemetry?.retryCount ?? 0), 0),
    staleElementRecoveries: actionEvents.filter((event) => event.type === "action.failed" && event.code === "STALE_UI_STATE").length,
    permissionPrompts: events.filter((event) => event.type === "permission.requested" && event.taskId === started?.taskId).length,
    durationMs: finished?.durationMs,
    startedAt: started?.at,
    finishedAt: finished?.at,
    observedWindow: latestDebug?.window,
    screenshot: latestDebug?.screenshot,
    failureReason,
  };
}

async function waitForTask(baseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let started;
  while (Date.now() < deadline) {
    const fresh = readEvents().slice(baseline);
    started ??= fresh.find((event) => event.type === "task.started");
    if (started) {
      const finished = fresh.find((event) => event.type === "task.finished" && event.taskId === started.taskId);
      if (finished) return { started, finished, events: fresh };
    }
    await delay(500);
  }
  return { started, finished: undefined, events: readEvents().slice(baseline) };
}

function readEvents() {
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function writeEvidence(document) {
  updateEnvironmentFromEvents(document);
  writeFileSync(resultsPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  writeFileSync(reportPath, renderReport(document), "utf8");
}

function renderReport(document) {
  const lines = ["# OpenUse macOS qualification", "", `Status: **${document.overallStatus}**`, `Run: ${document.runId}`, `Preflight: ${document.preflight}`, `Started: ${document.startedAt}`, `Finished: ${document.finishedAt ?? "IN PROGRESS"}`, "", "## Environment", "", "```json", JSON.stringify(document.environment, null, 2), "```", "", "## Scenarios", ""];
  for (const scenario of document.scenarios) {
    lines.push(`### ${scenario.title}`, "", `Success rate: ${scenario.successes}/${scenario.repeatTarget} (${Math.round(scenario.successRate * 100)}%)`, "");
    for (const attempt of scenario.attempts) lines.push(`- Run ${attempt.attempt}: **${attempt.success ? "PASS" : "FAIL"}** · model ${attempt.model} · actions ${attempt.actionCount ?? "?"} · accessibility-native ${attempt.accessibilityNativeActions} · element-coordinate ${attempt.elementCoordinateFallbacks} · vision-coordinate ${attempt.visionCoordinateFallbacks} · coordinate-input ${attempt.coordinateInputActions} · keyboard-input ${attempt.keyboardInputActions} · retries ${attempt.retries} · stale recoveries ${attempt.staleElementRecoveries} · permission prompts ${attempt.permissionPrompts} · scale ${attempt.screenshot?.scaleFactor ?? "?"}× · capture ${attempt.screenshot ? `${attempt.screenshot.width}×${attempt.screenshot.height} at (${attempt.screenshot.originX}, ${attempt.screenshot.originY})` : "?"} · duration ${attempt.durationMs ?? "?"}ms${attempt.failureReason ? ` · ${attempt.failureReason}` : ""}`);
    if (scenario.attempts.length === 0) lines.push("- No attempt recorded.");
    lines.push("");
  }
  lines.push("## Manual checks", "", "These require explicit operator confirmation and are not inferred by the harness.", "");
  for (const check of document.manualChecks) lines.push(`- ${check.title}: **${check.notApplicable ? "NOT_TESTED (single-monitor environment)" : check.status}**${check.metrics ? ` · ${JSON.stringify(check.metrics)}` : ""}${check.note ? ` · ${check.note}` : ""}`);
  lines.push("", "Screenshots are not stored by default. This report contains no model messages, chain-of-thought, API keys, typed values, or accessibility values.", "");
  return `${lines.join("\n")}\n`;
}

function overallStatus(document) {
  const scenariosPassed = document.scenarios.every((scenario) => scenario.successes === scenario.repeatTarget);
  const checksPassed = document.manualChecks.every((check) => check.status === "PASS" || (check.id === "multi-monitor" && check.notApplicable === true && document.environment.monitorCount === 1));
  const selfTestPassed = document.environment.selfTest?.ok === true && document.environment.monitorCount > 0;
  return document.preflight === "PASS" && scenariosPassed && checksPassed && selfTestPassed ? "QUALIFIED" : "INCOMPLETE";
}

function updateEnvironmentFromEvents(document) {
  const selfTest = readEvents().filter((event) => event.type === "qualification.self-test").at(-1)?.result;
  if (!selfTest) return;
  document.environment.monitorCount = selfTest.monitorCount;
  document.environment.accessibilityPermission = selfTest.accessibilityPermission;
  document.environment.screenRecordingPermission = selfTest.screenRecordingPermission;
  document.environment.dpi = selfTest.monitors.map((monitor) => ({ index: monitor.index, dpi: monitor.dpi, scale: `${Math.round((monitor.scaleFactor ?? monitor.dpi / 72) * 100)}%`, primary: monitor.primary }));
  document.environment.selfTest = selfTest;
}

function manualCheckDefinitions() {
  return [
    { id: "stop-restart", title: "Stop and restart", instructions: "Start a long-running TextEdit task, press Stop, confirm no later native action is issued, and immediately start another task. Confirm the second task can run." },
    { id: "permission-allow-once", title: "Permission: Allow Once", instructions: "Use an unknown application, choose Allow Once, and confirm the action runs only for that task/session." },
    { id: "permission-always-allow", title: "Permission: Always Allow", instructions: "Use an ordinary application, choose Always Allow, repeat the task, and confirm the persisted bundle-identity rule is used." },
    { id: "permission-deny", title: "Permission: Deny", instructions: "Use an unknown application, choose Deny, and confirm no unauthorized native action occurs." },
    { id: "permission-cancel", title: "Permission dialog cancellation", instructions: "Open a permission prompt, press Stop while it is open, and confirm the task cancels without a native action." },
    { id: "retina", title: "Retina / scale mapping", instructions: "Repeat a representative task and compare Accessibility point bounds with screenshot pixel dimensions and the reported scale factor." },
    { id: "vision-fallback", title: "Vision-coordinate fallback", instructions: "Use a target that Accessibility cannot identify, allow one screenshot fallback, and confirm the report records vision-coordinate." },
    { id: "multi-monitor", title: "Multi-monitor", instructions: "With more than one display connected, repeat a task on the secondary monitor and verify monitor count, origins, bounds, and scale. If only one display is available, record SKIP." },
  ];
}

function readScenario(file) {
  const scenario = JSON.parse(readFileSync(join(scenarioDirectory, file), "utf8"));
  if (scenario.platform !== "darwin" || !scenario.id || !scenario.task || scenario.repeatCount !== 3 || scenario.maxActions !== 30) throw new Error(`Invalid macOS qualification scenario: ${file}`);
  return scenario;
}

function readEnvironment() {
  return { platform: process.platform, arch: process.arch, node: process.versions.node, pnpm: commandVersion("pnpm", ["--version"]), monitorCount: null, dpi: [], note: "Monitor, permission, and scale values are populated from the qualification-only native self-test event when OpenUse starts." };
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
}

function normalizeCheck(value) {
  const normalized = value.trim().toUpperCase();
  return normalized === "PASS" || normalized === "FAIL" || normalized === "SKIP" ? normalized : "NOT_TESTED";
}

function parseNonNegativeInteger(value) {
  if (value.trim() === "" || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeSidecarState(value) {
  const normalized = value.trim().toUpperCase();
  return normalized === "CONNECTED" || normalized === "OFFLINE" ? normalized : "UNKNOWN";
}

function latestQualificationObservation() {
  const debug = readEvents().filter((event) => event.type === "qualification.debug").at(-1)?.debug;
  if (!debug) return undefined;
  return { tool: debug.tool, interactionMethod: debug.interactionMethod, targetApp: debug.targetApp, targetWindowId: debug.targetWindowId, targetWindowTitle: debug.targetWindowTitle, targetElementId: debug.targetElementId, window: debug.window, elementCount: debug.elementCount, truncated: debug.truncated, screenshot: debug.screenshot };
}

async function stopChild(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill();
  await delay(250);
}

function delay(milliseconds) { return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)); }
