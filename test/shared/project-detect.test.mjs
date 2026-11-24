import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { detectProject } from "../../src/project-detect.mjs";

async function fixture(files, packageJson) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-project-detect-"));
  try {
    if (packageJson) await fs.writeFile(path.join(target, "package.json"), JSON.stringify(packageJson));
    for (const file of files) {
      const filePath = path.join(target, file);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "");
    }
    return target;
  } catch (error) {
    await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
}

function assertProject(result, expected) {
  for (const key of ["languages", "frameworks", "tools"]) {
    assert.deepEqual(result[key].toSorted(), expected[key].toSorted());
  }
  assert.equal(result.packageManager, expected.packageManager);
  assert.equal(result.monorepo, expected.monorepo);
  assert.equal(result.repoType, expected.repoType);
}

test("project detection classifies empty and missing targets safely", async () => {
  const empty = await fixture([]);
  try {
    assertProject(await detectProject(empty), {
      languages: [], frameworks: [], tools: [], packageManager: null, monorepo: false, repoType: "generic"
    });
  } finally {
    await fs.rm(empty, { recursive: true, force: true });
  }
  const missing = await fs.mkdtemp(path.join(os.tmpdir(), "repo-pattern-project-detect-missing-"));
  await fs.rm(missing, { recursive: true, force: true });
  assertProject(await detectProject(missing), {
    languages: [], frameworks: [], tools: [], packageManager: null, monorepo: false, repoType: "generic"
  });
});

test("project detection identifies node frontend and package manager markers", async () => {
  const target = await fixture(["package-lock.json", "tsconfig.json", "vite.config.mjs", "pnpm-workspace.yaml"], {
    dependencies: { react: "1", "react-dom": "1", vite: "1", typescript: "1" }
  });
  try {
    assertProject(await detectProject(target), {
      languages: ["javascript", "typescript"], frameworks: ["react"], tools: ["bundler", "frontend-tooling"],
      packageManager: "npm", monorepo: true, repoType: "frontend"
    });
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("project detection classifies fullstack and backend repositories", async () => {
  const fullstack = await fixture(["pyproject.toml", "next.config.mjs", "package-lock.json"], {
    dependencies: { next: "1" }
  });
  const backend = await fixture(["go.mod", "Cargo.toml", "pom.xml", "yarn.lock"]);
  try {
    assertProject(await detectProject(fullstack), {
      languages: ["javascript", "python"], frameworks: ["nextjs", "react"], tools: [],
      packageManager: "npm", monorepo: false, repoType: "fullstack"
    });
    assertProject(await detectProject(backend), {
      languages: ["go", "java", "rust"], frameworks: [], tools: [],
      packageManager: "yarn", monorepo: false, repoType: "backend"
    });
  } finally {
    await Promise.all([fs.rm(fullstack, { recursive: true, force: true }), fs.rm(backend, { recursive: true, force: true })]);
  }
});

test("project detection recognizes extension-only languages and package manager precedence", async () => {
  const target = await fixture([
    "setup.py", "gradlew", "uv.lock", "main.cc", "module.cxx", "solution.sln", "module.fs",
    "script.pm", "library.gemspec", "app.xcodeproj", "workspace.xcworkspace", "build-profile.json5",
    "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "package-lock.json", "turbo.json"
  ]);
  try {
    assertProject(await detectProject(target), {
      languages: ["python", "java", "cpp", "csharp", "fsharp", "perl", "ruby", "swift", "arkts"],
      frameworks: [], tools: [], packageManager: "pnpm", monorepo: true, repoType: "backend"
    });
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("project detection treats malformed package metadata as an input error", async () => {
  const target = await fixture([]);
  try {
    await fs.writeFile(path.join(target, "package.json"), "{", "utf8");
    await assert.rejects(() => detectProject(target), SyntaxError);
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});

test("project detection recognizes language and framework marker families", async () => {
  const target = await fixture([
    "tsconfig.base.json", "requirements.txt", "build.gradle.kts", "pubspec.yaml", "main.cpp", "app.csproj", "app.fsproj", "script.pl",
    "composer.json", "Gemfile", "Package.swift", "oh-package.json5", "angular.json", "nuxt.config.ts", "webpack.config.js", "bun.lock",
    "pnpm-workspace.yaml"
  ], {
    devDependencies: {
      "@angular/core": "1", vue: "1", nuxt: "1", expo: "1", "@vitejs/plugin-vue": "1", playwright: "1",
      "org.jetbrains.kotlin.jvm": "1"
    }
  });
  try {
    assertProject(await detectProject(target), {
      languages: ["javascript", "typescript", "python", "java", "kotlin", "dart", "cpp", "csharp", "fsharp", "perl", "php", "ruby", "swift", "arkts"],
      frameworks: ["react-native", "angular", "vue", "nuxt"], tools: ["bundler", "frontend-tooling"],
      packageManager: "bun", monorepo: true, repoType: "fullstack"
    });
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
