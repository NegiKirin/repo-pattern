import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function listModules(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listModules(target);
    return entry.isFile() && entry.name.endsWith(".mjs") ? [target] : [];
  }));
  return files.flat();
}

function limitFor(file, projectRoot) {
  const relative = path.relative(projectRoot, file).split(path.sep).join("/");
  if (relative === "scripts/lib/rules.mjs") return 300;
  if (relative === "scripts/lib/ecc-sync-transaction.mjs") return 600;
  if (relative.startsWith("scripts/lib/ecc-") && relative.endsWith(".mjs")) return 300;
  if (relative === "scripts/self-check.mjs" || relative.startsWith("scripts/self-check/")) return 400;
  return null;
}

export async function checkModuleLimits({ projectRoot = root } = {}) {
  const candidates = [path.join(projectRoot, "scripts", "lib", "rules.mjs"), ...await listModules(path.join(projectRoot, "scripts", "lib")), path.join(projectRoot, "scripts", "self-check.mjs"), ...await listModules(path.join(projectRoot, "scripts", "self-check"))];
  const failures = [];
  for (const file of new Set(candidates)) {
    const relative = path.relative(projectRoot, file).split(path.sep).join("/");
    const limit = limitFor(file, projectRoot);
    if (limit === null) continue;
    const lines = (await fs.readFile(file, "utf8")).split("\n").length;
    if (lines > limit) failures.push(`${relative}: ${lines} lines exceeds ${limit}-line limit`);
  }
  if (failures.length) throw new Error(`Module size limit failed:\n${failures.join("\n")}`);
  return "Module size limits passed";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(await checkModuleLimits());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
