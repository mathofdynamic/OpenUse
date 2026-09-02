import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconSource = join(repositoryRoot, "app-logo", "logo.png");
const builderConfig = join(repositoryRoot, "apps", "desktop", "electron-builder.mac.yml");
const desktopPackage = join(repositoryRoot, "apps", "desktop", "package.json");

if (process.platform !== "darwin") {
  console.error("macOS packaging inputs can only be checked on macOS.");
  process.exit(1);
}

const failures = [];
if (!existsSync(iconSource)) failures.push(`Missing exact icon source: ${iconSource}`);
if (!existsSync(builderConfig)) failures.push(`Missing electron-builder configuration: ${builderConfig}`);
if (existsSync(builderConfig)) {
  const config = readFileSync(builderConfig, "utf8");
  for (const required of ["com.openuse.app", "productName: OpenUse", "icon: OpenUse.icns", "OpenUseMacController"]) {
    if (!config.includes(required)) failures.push(`Packaging configuration is missing: ${required}`);
  }
}
if (existsSync(desktopPackage)) {
  const packageJson = JSON.parse(readFileSync(desktopPackage, "utf8"));
  if (packageJson.devDependencies?.["electron-builder"] !== "26.15.3") failures.push("electron-builder 26.15.3 must remain pinned in apps/desktop/package.json");
}
try {
  const version = execFileSync("pnpm", ["--filter", "@openuse/desktop", "exec", "electron-builder", "--version"], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (version !== "26.15.3") failures.push(`electron-builder 26.15.3 is required; found ${version || "unknown"}`);
} catch {
  failures.push("electron-builder is not available; run pnpm install --frozen-lockfile");
}

if (failures.length > 0) {
  console.error("macOS packaging inputs: FAIL");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("macOS packaging inputs: PASS");
