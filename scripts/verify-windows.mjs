import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmCommand = "pnpm.cmd";

if (process.platform !== "win32") {
  console.error("verify:windows must run on Windows. GUI and native execution were not attempted.");
  process.exit(1);
}

const checks = [];
runCheck("Qualification definitions", process.execPath, ["scripts/check-qualification.mjs"]);
runCheck("Environment", process.execPath, ["scripts/setup-windows.mjs", "--check-only"]);
runCheck("TypeScript lint", pnpmCommand, ["lint"]);
runCheck("TypeScript typecheck", pnpmCommand, ["typecheck"]);
runCheck("TypeScript tests", pnpmCommand, ["test"]);
runCheck("Electron build", pnpmCommand, ["build"]);
runCheck("Native build", pnpmCommand, ["native:build"]);
runCheck("Native tests", pnpmCommand, ["native:test"]);
runCheck("Sidecar IPC/self-test", pnpmCommand, ["--filter", "@openuse/desktop", "test:windows"]);

const failed = checks.some((check) => !check.passed);
console.log("\nOpenUse Windows Preflight\n");
for (const check of checks) console.log(`${check.label.padEnd(24, ".")} ${check.passed ? "PASS" : "FAIL"}`);
console.log(`\n${failed ? "NOT READY FOR GUI QUALIFICATION" : "READY FOR GUI QUALIFICATION"}`);
process.exit(failed ? 1 : 0);

function runCheck(label, command, args) {
  console.log(`\n[${label}] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", windowsHide: true, ...(command.toLowerCase().endsWith(".cmd") ? { shell: true } : {}) });
  const passed = result.status === 0 && !result.error;
  checks.push({ label, passed });
  if (!passed) console.error(`[${label}] failed; the preflight will not report readiness.`);
}
