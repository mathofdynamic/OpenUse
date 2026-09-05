import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { release as osRelease } from "node:os";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check-only");
const requiredNodeMajor = 20;
const requiredPnpm = "10.14.0";

if (process.platform !== "win32") {
  console.error("setup:windows must run on Windows. No Windows machine changes were attempted.");
  process.exit(1);
}

console.log(`OpenUse Windows ${checkOnly ? "environment check" : "setup"}`);
const failures = [];

const windowsBuild = osRelease();
console.log(`Windows build .. ${windowsBuild}`);
if (!/^10\./.test(windowsBuild)) failures.push(`Windows 10/11 is required; found OS build ${windowsBuild}.`);

if (process.arch !== "x64") {
  failures.push(`Windows x64 is required; this Node process reports ${process.arch}.`);
}

const nodeVersion = process.versions.node;
const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
if (!Number.isFinite(nodeMajor) || nodeMajor < requiredNodeMajor) {
  failures.push(`Node.js ${requiredNodeMajor}+ is required; found ${nodeVersion}. Install the current Node.js LTS from https://nodejs.org/.`);
} else {
  console.log(`Node.js ........ ${nodeVersion} PASS`);
}

const gitVersion = commandVersion("git", ["--version"]);
if (!gitVersion) failures.push("Git is required. Install Git for Windows from https://git-scm.com/download/win.");
else console.log(`Git ............ ${gitVersion} PASS`);

const pnpmCommand = "pnpm.cmd";
const pnpmVersion = commandVersion(pnpmCommand, ["--version"]);
if (!pnpmVersion) {
  failures.push(`pnpm ${requiredPnpm} is required. Enable Corepack or install pnpm from https://pnpm.io/installation.`);
} else if (pnpmVersion !== requiredPnpm) {
  failures.push(`pnpm ${requiredPnpm} is required by package.json; found ${pnpmVersion}. Run: corepack prepare pnpm@${requiredPnpm} --activate`);
} else {
  console.log(`pnpm .......... ${pnpmVersion} PASS`);
}

const dotnetVersion = commandVersion("dotnet", ["--version"]);
const dotnetSdks = commandOutput("dotnet", ["--list-sdks"]);
if (!dotnetVersion || !dotnetSdks || !dotnetSdks.split(/\r?\n/).some((line) => /^8\./.test(line.trim()))) {
  failures.push(".NET 8 SDK is required, including the Windows Desktop targeting packs used by WPF/Windows Forms. Install the .NET 8 SDK from https://dotnet.microsoft.com/download/dotnet/8.0.");
} else {
  console.log(`.NET SDK ....... ${dotnetVersion} (8.x installed) PASS`);
}

if (failures.length > 0) {
  console.error("\nWindows setup cannot continue:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nThis command does not install operating-system software automatically.");
  process.exit(1);
}

if (checkOnly) {
  console.log("\nEnvironment checks passed. No dependencies or machine settings were changed.");
  process.exit(0);
}

run(pnpmCommand, ["install", "--frozen-lockfile"]);
run(pnpmCommand, ["native:build"]);
console.log("\nWindows project preparation complete. Run pnpm verify:windows next.");

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...(command.toLowerCase().endsWith(".cmd") ? { shell: true } : {}) }).trim();
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
    execFileSync(command, args, { cwd: repositoryRoot, stdio: "inherit", ...(command.toLowerCase().endsWith(".cmd") ? { shell: true } : {}) });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    console.error(`Command failed${typeof status === "number" ? ` with exit code ${status}` : ""}.`);
    process.exit(1);
  }
}
