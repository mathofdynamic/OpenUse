import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const vite = spawn(pnpm, ["exec", "vite", "--host", "127.0.0.1"], { stdio: "inherit" });
const devUrl = "http://127.0.0.1:5173";

async function waitForVite() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await fetch(devUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Vite did not start in time.");
}

try {
  await waitForVite();
  execFileSync(pnpm, ["exec", "node", `${here}/build-main.mjs`], { stdio: "inherit" });
  const electron = spawn(pnpm, ["exec", "electron", "."], {
    stdio: "inherit",
    env: { ...process.env, VITE_DEV_SERVER_URL: devUrl },
  });
  const exitCode = await new Promise((resolve) => electron.once("exit", (code) => resolve(code ?? 0)));
  process.exitCode = exitCode;
} finally {
  vite.kill();
}
