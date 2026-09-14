import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryRoot, "apps", "desktop");
const outputDirectory = join(repositoryRoot, "dist", "windows");
const iconPath = join(desktopDirectory, ".build", "windows", "OpenUse.ico");
const controllerDirectory = join(repositoryRoot, "native", "windows", "publish");
const controllerFiles = [
  "OpenUse.WindowsController.exe",
  "OpenUse.WindowsController.dll",
  "OpenUse.WindowsController.deps.json",
  "OpenUse.WindowsController.runtimeconfig.json",
];
const controllerPath = join(controllerDirectory, controllerFiles[0]);

if (process.platform !== "win32") {
  console.error("dist:windows must run on Windows. No packaging was attempted.");
  process.exit(1);
}
if (process.arch !== "x64") {
  console.error(`dist:windows requires x64; found ${process.arch}.`);
  process.exit(1);
}
if (!existsSync(join(repositoryRoot, "app-logo", "logo.png"))) throw new Error("Missing required app-logo/logo.png.");

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
run(process.execPath, [join(repositoryRoot, "scripts", "generate-windows-icon.mjs")], repositoryRoot);
run("pnpm.cmd", ["build"], repositoryRoot);
run("pnpm.cmd", ["native:build"], repositoryRoot);
if (!existsSync(controllerPath)) throw new Error(`The Windows controller was not published: ${controllerPath}`);
for (const file of controllerFiles) {
  if (!existsSync(join(controllerDirectory, file))) throw new Error(`The packaged Windows controller dependency is missing: ${join(controllerDirectory, file)}`);
}

// The workspace uses pnpm symlinks between packages, while the Electron main
// and renderer bundles are self-contained. Package a clean staged app so the
// builder cannot traverse the development workspace or accidentally encode a
// repository path into the installed product.
const stagingDirectory = join(desktopDirectory, ".build", "windows-app");
const stagingResources = join(stagingDirectory, "build-resources");
const stagingConfig = join(stagingDirectory, "electron-builder.json");
rmSync(stagingDirectory, { recursive: true, force: true });
mkdirSync(stagingResources, { recursive: true });
cpSync(join(desktopDirectory, "dist"), join(stagingDirectory, "dist"), { recursive: true });
cpSync(iconPath, join(stagingResources, "OpenUse.ico"));
writeFileSync(join(stagingDirectory, "package.json"), `${JSON.stringify({
  name: "openuse-desktop",
  version: "0.2.0",
  productName: "OpenUse",
  description: "A local-first, AI-agnostic Computer Use runtime.",
  author: "OpenUse contributors",
  packageManager: "npm@10.0.0",
  main: "dist/main.cjs",
}, null, 2)}\n`, "utf8");
writeFileSync(stagingConfig, `${JSON.stringify({
  appId: "com.openuse.app",
  productName: "OpenUse",
  asar: true,
  electronVersion: "43.4.1",
  npmRebuild: false,
  nodeGypRebuild: false,
  directories: { output: outputDirectory, buildResources: stagingResources },
  files: ["dist/**/*", "package.json"],
  extraResources: [{ from: controllerDirectory, to: "native/windows", filter: controllerFiles }],
  win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "OpenUse.ico", artifactName: "OpenUse-Setup-${version}-${arch}.${ext}" },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "OpenUse" },
}, null, 2)}\n`, "utf8");
try {
  run("pnpm.cmd", ["exec", "electron-builder", "--projectDir", stagingDirectory, "--config", stagingConfig, "--publish", "never"], desktopDirectory);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}

const installer = readdirSync(outputDirectory).map((entry) => join(outputDirectory, entry)).find((path) => path.toLowerCase().endsWith(".exe"));
if (!installer) throw new Error(`Packaging completed without an installer under ${outputDirectory}.`);
console.log("\nOpenUse Windows package ready");
console.log(`Installer .......... ${installer}`);
console.log(`Embedded controller . ${controllerPath}`);
console.log(`Icon ............... ${iconPath}`);

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, stdio: "inherit", ...(process.platform === "win32" && command.toLowerCase().endsWith(".cmd") ? { shell: true } : {}) });
}
