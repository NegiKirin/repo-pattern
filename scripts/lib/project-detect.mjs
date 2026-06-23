import fs from "node:fs/promises";
import path from "node:path";
import { exists, readJson } from "./fs-utils.mjs";

async function hasAny(target, rels) {
  for (const rel of rels) {
    if (exists(path.join(target, rel))) return true;
  }
  return false;
}

function depNames(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {})
  ]);
}

function hasDep(deps, names) {
  return names.some((name) => deps.has(name));
}

async function findByExtension(target, extension) {
  try {
    const entries = await fs.readdir(target);
    return entries.some((entry) => entry.endsWith(extension));
  } catch {
    return false;
  }
}

export async function detectProject(target) {
  const pkg = await readJson(path.join(target, "package.json"), null);
  const deps = pkg ? depNames(pkg) : new Set();

  const languages = new Set();
  const frameworks = new Set();
  const tools = new Set();

  const hasPackageJson = !!pkg;
  const hasTsConfig = await hasAny(target, ["tsconfig.json", "tsconfig.base.json"]);

  if (hasPackageJson) languages.add("javascript");
  if (hasTsConfig || hasDep(deps, ["typescript", "ts-node", "tsx"])) languages.add("typescript");

  if (await hasAny(target, ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "uv.lock", "poetry.lock"])) languages.add("python");
  if (await hasAny(target, ["go.mod"])) languages.add("go");
  if (await hasAny(target, ["composer.json"])) languages.add("php");
  if (await hasAny(target, ["Gemfile"]) || await findByExtension(target, ".gemspec")) languages.add("ruby");
  if (await hasAny(target, ["Package.swift"]) || await findByExtension(target, ".xcodeproj") || await findByExtension(target, ".xcworkspace")) languages.add("swift");
  if (await hasAny(target, ["oh-package.json5", "build-profile.json5", "hvigorfile.ts"])) languages.add("arkts");

  if (hasDep(deps, ["next"]) || await hasAny(target, ["next.config.js", "next.config.mjs", "next.config.ts"])) {
    frameworks.add("nextjs");
    frameworks.add("react");
  }

  if (hasDep(deps, ["react", "react-dom"])) frameworks.add("react");
  if (hasDep(deps, ["@angular/core"]) || await hasAny(target, ["angular.json"])) frameworks.add("angular");
  if (hasDep(deps, ["vue", "@vitejs/plugin-vue"])) frameworks.add("vue");
  if (hasDep(deps, ["nuxt"]) || await hasAny(target, ["nuxt.config.js", "nuxt.config.mjs", "nuxt.config.ts"])) {
    frameworks.add("nuxt");
    frameworks.add("vue");
  }

  if (await hasAny(target, ["vite.config.js", "vite.config.mjs", "vite.config.ts", "webpack.config.js"])) tools.add("bundler");
  if (hasDep(deps, ["vite", "webpack", "rollup", "parcel", "playwright", "@playwright/test", "cypress"])) tools.add("frontend-tooling");

  const monorepo = await hasAny(target, ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json"]);

  let packageManager = null;
  if (await hasAny(target, ["pnpm-lock.yaml"])) packageManager = "pnpm";
  else if (await hasAny(target, ["yarn.lock"])) packageManager = "yarn";
  else if (await hasAny(target, ["bun.lockb", "bun.lock"])) packageManager = "bun";
  else if (await hasAny(target, ["package-lock.json"])) packageManager = "npm";

  const frontendFrameworks = ["nextjs", "react", "angular", "vue", "nuxt"];
  const hasFrontend = [...frameworks].some((fw) => frontendFrameworks.includes(fw)) || tools.has("frontend-tooling");
  const hasBackend = languages.has("python") || languages.has("go") || languages.has("php") || languages.has("ruby");

  let repoType = "generic";
  if (hasFrontend && hasBackend) repoType = "fullstack";
  else if (hasFrontend) repoType = "frontend";
  else if (hasBackend) repoType = "backend";
  else if (hasPackageJson) repoType = "node";

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    tools: [...tools],
    packageManager,
    monorepo,
    repoType
  };
}
