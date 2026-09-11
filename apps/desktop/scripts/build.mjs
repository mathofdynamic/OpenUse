import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build as buildRenderer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [join(here, "build-main.mjs")], { stdio: "inherit" });
await buildRenderer({ configFile: join(here, "..", "vite.config.ts") });
