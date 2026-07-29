import { spawnSync } from "node:child_process";

const durationsMs = [];
for (let run = 0; run < 3; run += 1) {
  const started = performance.now();
  const result = spawnSync("npm", ["test"], {
    stdio: ["ignore", "pipe", "inherit"],
    shell: process.platform === "win32"
  });
  process.stderr.write(result.stdout || "");
  if (result.status !== 0) process.exit(result.status || 1);
  durationsMs.push(Math.round(performance.now() - started));
}
const sorted = [...durationsMs].sort((left, right) => left - right);
console.log(JSON.stringify({ node: process.version, runs: 3, durationsMs, medianMs: sorted[1] }));
