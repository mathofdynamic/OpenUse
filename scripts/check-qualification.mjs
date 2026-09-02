import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarioDirectory = join(repositoryRoot, "qualification", "scenarios");
const files = ["notepad-typing.json", "calculator.json", "notepad-save-as.json"];
const ids = new Set();

for (const file of files) {
  let scenario;
  try {
    scenario = JSON.parse(readFileSync(join(scenarioDirectory, file), "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${file}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  if (typeof scenario.id !== "string" || ids.has(scenario.id)) throw new Error(`${file} must have a unique string id.`);
  if (typeof scenario.title !== "string" || typeof scenario.task !== "string" || typeof scenario.expectedOutcome !== "string") throw new Error(`${file} is missing goal metadata.`);
  if (scenario.maxActions !== 30 || scenario.repeatCount !== 3) throw new Error(`${file} must retain the 30-action and 3-run qualification limits.`);
  if (!Array.isArray(scenario.criteria) || scenario.criteria.length < 1 || scenario.criteria.some((criterion) => typeof criterion !== "string")) throw new Error(`${file} must contain acceptance criteria.`);
  ids.add(scenario.id);
}

console.log(`Qualification definitions: ${files.length} PASS`);
