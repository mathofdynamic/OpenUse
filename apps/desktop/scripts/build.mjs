import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "node", `${here}/build-main.mjs`], { stdio: "inherit" });
execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["exec", "vite", "build"], { stdio: "inherit" });
