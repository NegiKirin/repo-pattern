import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function installGraphifyStubs() {
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-graphify-bin-"));
  const write = async (name, source) => {
    const file = path.join(bin, name);
    await fs.writeFile(file, `#!${process.execPath}\n${source}\n`, { mode: 0o755 });
  };
  await write("python3", `
if (process.argv[2] === "--version") console.log("Python 3.12.0");
`);
  await write("python", "");
  await write("graphify", `
import fs from "node:fs/promises";
import path from "node:path";
if (process.argv[2] === "extract") {
  await fs.mkdir(path.join(process.cwd(), "graphify-out"), { recursive: true });
  await fs.writeFile(path.join(process.cwd(), "graphify-out", "graph.json"), "{}\\n");
}
`);
  await write("graphify-mcp", "");
  const originalPath = process.env.PATH;
  const originalStubDir = process.env.REPO_PATTERN_GRAPHIFY_STUB_DIR;
  process.env.REPO_PATTERN_GRAPHIFY_STUB_DIR = bin;
  process.env.PATH = `${bin}${path.delimiter}${originalPath || ""}`;
  return async () => {
    process.env.PATH = originalPath;
    if (originalStubDir === undefined) delete process.env.REPO_PATTERN_GRAPHIFY_STUB_DIR;
    else process.env.REPO_PATTERN_GRAPHIFY_STUB_DIR = originalStubDir;
    await fs.rm(bin, { recursive: true, force: true });
  };
}
