import { cleanupProject } from "./cleanup.mjs";
import { initProject } from "./init.mjs";

export async function migrateProject(options) {
  console.log(`Migrating target: ${options.target}`);
  await cleanupProject(options);
  await initProject({ ...options, force: true, migrate: true });
}
