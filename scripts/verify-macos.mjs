import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") {
  console.error("verify:macos must run on macOS. No GUI or native execution was attempted.");
  process.exit(1);
}

const checks = [];
runCheck("Qualification definitions", process.execPath, ["scripts/check-qualification.mjs"]);
runCheck("Environment", process.execPath, ["scripts/setup-macos.mjs", "--check-only"]);
runCheck("TypeScript lint", "pnpm", ["lint"]);
runCheck("TypeScript typecheck", "pnpm", ["typecheck"]);
runCheck("TypeScript tests", "pnpm", ["test"]);
runCheck("Electron build", "pnpm", ["build"]);
runCheck("macOS native build", "pnpm", ["native:build:macos"]);
runCheck("macOS native tests", "pnpm", ["native:test:macos"]);
runCheck("Sidecar IPC smoke", "pnpm", ["--filter", "@openuse/desktop", "test:macos"]);
runCheck("Native self-test and privacy grants", process.execPath, ["apps/desktop/scripts/test-macos.mjs", "--require-permissions"]);

const failed = checks.some((check) => !check.passed);
console.log("\nOpenUse macOS Preflight\n");
for (const check of checks) console.log(`${check.label.padEnd(30, ".")} ${check.passed ? "PASS" : "FAIL"}`);
console.log(`\n${failed ? "NOT READY FOR GUI QUALIFICATION" : "READY FOR GUI QUALIFICATION"}`);
process.exit(failed ? 1 : 0);

function runCheck(label, command, args) {
  console.log(`\n[${label}] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });
  const passed = result.status === 0 && !result.error;
  checks.push({ label, passed });
  if (!passed) console.error(`[${label}] failed; the preflight will not report readiness.`);
}
