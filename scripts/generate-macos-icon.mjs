import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repositoryRoot, "app-logo", "logo.png");
const outputDirectory = resolve(repositoryRoot, "apps", "desktop", ".build", "macos");
const iconsetDirectory = join(outputDirectory, "OpenUse.iconset");
const iconPath = join(outputDirectory, "OpenUse.icns");

if (process.platform !== "darwin") {
  throw new Error("macOS application icons can only be generated on macOS.");
}
if (!existsSync(source)) {
  throw new Error(`Required OpenUse icon source is missing: ${source}. Packaging will not substitute another asset.`);
}

mkdirSync(outputDirectory, { recursive: true });
rmSync(iconsetDirectory, { recursive: true, force: true });
rmSync(iconPath, { force: true });
mkdirSync(iconsetDirectory, { recursive: true });

for (const size of [16, 32, 128, 256, 512]) {
  renderIcon(size, join(iconsetDirectory, `icon_${size}x${size}.png`));
  renderIcon(size * 2, join(iconsetDirectory, `icon_${size}x${size}@2x.png`));
}

execFileSync("iconutil", ["-c", "icns", iconsetDirectory, "-o", iconPath], { stdio: "inherit" });
console.log(`Generated ${iconPath} from ${source}`);

function renderIcon(size, output) {
  const resized = `${output}.resized.png`;
  execFileSync("sips", ["--resampleHeightWidthMax", String(size), source, "--out", resized], { stdio: "ignore" });
  // Pad non-square artwork with transparent pixels. The source artwork is not
  // cropped, stretched, recolored, or given a generated background.
  execFileSync("sips", ["--padToHeightWidth", String(size), String(size), "--padColor", "00000000", resized, "--out", output], { stdio: "ignore" });
  rmSync(resized, { force: true });
}
