import { chmod, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryRoot, "apps", "desktop");
const nativeController = join(repositoryRoot, "native", "macos", ".build", "release", "OpenUseMacController");
const outputDirectory = join(repositoryRoot, "dist", "macos");
const iconSource = join(repositoryRoot, "app-logo", "logo.png");
const iconPath = join(desktopDirectory, ".build", "macos", "OpenUse.icns");

if (process.platform !== "darwin") {
  console.error("dist:macos must run on macOS. No packaging was attempted.");
  process.exit(1);
}
if (process.arch !== "arm64") {
  console.error(`dist:macos currently produces an Apple Silicon arm64 build; found ${process.arch}.`);
  process.exit(1);
}
if (!existsSync(iconSource)) {
  console.error(`Missing required OpenUse icon source: ${iconSource}`);
  console.error("Restore the exact app-logo/logo.png asset; no replacement icon will be generated.");
  process.exit(1);
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const packagingEnv = { ...process.env, COPYFILE_DISABLE: "1", CSC_IDENTITY_AUTO_DISCOVERY: "false" };
delete packagingEnv.ELECTRON_RUN_AS_NODE;
const stagingRoot = mkdtempSync(join(tmpdir(), "openuse-macos-package-"));
const stagingDirectory = join(stagingRoot, "artifacts");
mkdirSync(stagingDirectory, { recursive: true });

try {
  run("pnpm", ["build"], repositoryRoot, packagingEnv);
  removeAppleDouble(join(desktopDirectory, "dist"));
  run("pnpm", ["native:build:macos"], repositoryRoot, packagingEnv);
  if (!existsSync(nativeController)) throw new Error(`The Swift controller was not built: ${nativeController}`);
  await chmod(nativeController, 0o755);
  run(process.execPath, [join(repositoryRoot, "scripts", "generate-macos-icon.mjs")], repositoryRoot, packagingEnv);
  if (!existsSync(iconPath)) throw new Error(`The macOS icon was not generated: ${iconPath}`);

  run("pnpm", ["exec", "electron-builder", "--config", "electron-builder.mac.yml", "--publish", "never", `--config.directories.output=${stagingDirectory}`], desktopDirectory, packagingEnv);

  const stagedAppPath = findArtifact(stagingDirectory, (path) => path.endsWith("/OpenUse.app"));
  const stagedDmgPath = findArtifact(stagingDirectory, (path) => path.endsWith(".dmg"));
  if (!stagedAppPath) throw new Error(`Packaging completed without an OpenUse.app under ${stagingDirectory}.`);
  if (!stagedDmgPath) throw new Error(`Packaging completed without a DMG under ${stagingDirectory}.`);

  const appPath = join(outputDirectory, "OpenUse.app");
  const dmgPath = join(outputDirectory, basename(stagedDmgPath));
  run("ditto", ["--norsrc", stagedAppPath, appPath], repositoryRoot, packagingEnv);
  run("ditto", ["--norsrc", stagedDmgPath, dmgPath], repositoryRoot, packagingEnv);
  removeAppleDouble(outputDirectory);

  const infoPlist = join(appPath, "Contents", "Info.plist");
  const bundledController = join(appPath, "Contents", "Resources", "native", "macos", "OpenUseMacController");
  if (!existsSync(infoPlist)) throw new Error(`Packaged Info.plist is missing: ${infoPlist}`);
  if (!existsSync(bundledController)) throw new Error(`Packaged Swift controller is missing: ${bundledController}`);
  const bundleId = readPlistValue(infoPlist, "CFBundleIdentifier");
  const productName = readPlistValue(infoPlist, "CFBundleName");
  const iconFile = readPlistValue(infoPlist, "CFBundleIconFile");
  if (bundleId !== "com.openuse.app") throw new Error(`Packaged Info.plist has unexpected bundle ID: ${bundleId ?? "missing"}`);
  if (productName !== "OpenUse") throw new Error(`Packaged Info.plist has unexpected product name: ${productName ?? "missing"}`);
  if (!iconFile || !existsSync(join(appPath, "Contents", "Resources", iconFile))) throw new Error(`Packaged Info.plist points to a missing icon file: ${iconFile ?? "missing"}`);

  console.log("\nOpenUse macOS package ready");
  console.log(`App .............. ${appPath}`);
  console.log(`DMG .............. ${dmgPath}`);
  console.log(`Bundle ID ........ ${bundleId}`);
  console.log(`Icon ............. ${iconFile}`);
  console.log(`Icon source ...... ${iconSource}`);
  console.log(`Embedded engine .. ${bundledController}`);
  console.log("Signing .......... unsigned local build (Developer ID/notarization not configured)");
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

function run(command, args, cwd, commandEnv = process.env) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, env: commandEnv, stdio: "inherit" });
}

function findArtifact(directory, predicate) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (predicate(path)) return path;
    if (lstatSync(path).isDirectory()) {
      const found = findArtifact(path, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

function removeAppleDouble(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (entry.startsWith("._")) {
      rmSync(path, { recursive: true, force: true });
    } else if (lstatSync(path).isDirectory()) {
      removeAppleDouble(path);
    }
  }
}

function readPlistValue(infoPlist, key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}
