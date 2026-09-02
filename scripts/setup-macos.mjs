import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check-only");
const requiredNodeMajor = 20;
const requiredPnpm = "10.14.0";

if (process.platform !== "darwin") {
  console.error("setup:macos must run on macOS. No machine changes were attempted.");
  process.exit(1);
}

console.log(`OpenUse macOS ${checkOnly ? "environment check" : "setup"}`);
console.log(`macOS .......... ${commandVersion("sw_vers", ["-productVersion"]) ?? "unknown"}`);
console.log(`Architecture ... ${process.arch}`);
const failures = [];

if (!process.arch.match(/^(arm64|x64)$/)) failures.push(`macOS arm64 or x64 is required; found ${process.arch}.`);
const nodeVersion = process.versions.node;
const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
if (!Number.isFinite(nodeMajor) || nodeMajor < requiredNodeMajor) {
  failures.push(`Node.js ${requiredNodeMajor}+ is required; found ${nodeVersion}. Install the current Node.js LTS from https://nodejs.org/.`);
} else console.log(`Node.js ........ ${nodeVersion} PASS`);

const gitVersion = commandVersion("git", ["--version"]);
if (!gitVersion) failures.push("Git is required. Install it from https://git-scm.com/download/mac.");
else console.log(`Git ............ ${gitVersion} PASS`);

const pnpmVersion = commandVersion("pnpm", ["--version"]);
if (!pnpmVersion) failures.push(`pnpm ${requiredPnpm} is required. Enable Corepack or install pnpm from https://pnpm.io/installation.`);
else if (pnpmVersion !== requiredPnpm) failures.push(`pnpm ${requiredPnpm} is required by package.json; found ${pnpmVersion}. Run: corepack prepare pnpm@${requiredPnpm} --activate`);
else console.log(`pnpm ........... ${pnpmVersion} PASS`);

const swiftVersion = commandVersion("swift", ["--version"]);
if (!swiftVersion) failures.push("Swift 5.9+ is required. Install Xcode Command Line Tools with: xcode-select --install");
else console.log(`Swift .......... ${swiftVersion.replace(/\s+/g, " ")} PASS`);

const xcodePath = commandVersion("xcode-select", ["-p"]);
if (!xcodePath) failures.push("Xcode Command Line Tools are required. Run: xcode-select --install");
else console.log(`Developer tools  ${xcodePath} PASS`);

if (failures.length > 0) {
  console.error("\nmacOS setup cannot continue:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nThis command does not install operating-system software or change privacy permissions automatically.");
  process.exit(1);
}

if (checkOnly) {
  console.log("\nEnvironment checks passed. No dependencies, binaries, or machine settings were changed.");
  process.exit(0);
}

run("pnpm", ["install", "--frozen-lockfile"]);
run("pnpm", ["native:build:macos"]);
console.log("\nmacOS project preparation complete. Grant Accessibility and Screen Recording permissions, then run pnpm verify:macos.");

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return undefined;
  }
}

function commandVersion(command, args) {
  return commandOutput(command, args)?.split(/\r?\n/)[0];
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  try {
    execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit" });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    console.error(`Command failed${typeof status === "number" ? ` with exit code ${status}` : ""}.`);
    process.exit(1);
  }
}
