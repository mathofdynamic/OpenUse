import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Electron-builder skips certificate discovery for the local qualification
 * package. Apple Silicon still needs every executable in the bundle to carry
 * a valid local signature, especially helper tools in Contents/MacOS. This
 * hook applies a local ad-hoc signature before electron-builder creates the
 * DMG. A future Developer ID configuration should disable this hook and let
 * electron-builder sign with that identity instead.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin" || process.env.OPENUSE_LOCAL_ADHOC_SIGN !== "1") return;

  const appPath = join(context.appOutDir, "OpenUse.app");
  const machOFiles = [];
  collectMachOFiles(appPath, machOFiles);
  for (const file of machOFiles) {
    sign(file);
  }
  sign(appPath, ["--deep", "--identifier", "com.openuse.app"]);
  verify(appPath);
}

function collectMachOFiles(directory, result) {
  for (const entry of readdirSync(directory)) {
    if (entry.startsWith("._")) continue;
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      collectMachOFiles(path, result);
      continue;
    }
    if (isMachO(path)) result.push(path);
  }
}

function isMachO(path) {
  try {
    const description = execFileSync("file", ["-b", path], { encoding: "utf8" });
    return description.includes("Mach-O");
  } catch {
    return false;
  }
}

function sign(path, options = []) {
  execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", ...options, path], { stdio: "inherit" });
}

function verify(path) {
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", path], { stdio: "inherit" });
}
