const RULE_PACKS = new Set([
  "common",
  "typescript",
  "angular",
  "vue",
  "nuxt",
  "python",
  "golang",
  "web",
  "swift",
  "php",
  "ruby",
  "arkts"
]);

export function selectEccRules(detection) {
  const languages = new Set(detection.languages || []);
  const frameworks = new Set(detection.frameworks || []);
  const tools = new Set(detection.tools || []);
  const selected = new Set(["common"]);

  const hasNode = languages.has("javascript") || languages.has("typescript");
  const hasFrontend = (
    frameworks.has("nextjs") ||
    frameworks.has("react") ||
    frameworks.has("angular") ||
    frameworks.has("vue") ||
    frameworks.has("nuxt") ||
    tools.has("frontend-tooling") ||
    detection.repoType === "frontend" ||
    detection.repoType === "fullstack"
  );

  if (hasNode || hasFrontend) selected.add("typescript");
  if (hasFrontend) selected.add("web");

  if (frameworks.has("angular")) selected.add("angular");
  if (frameworks.has("vue")) selected.add("vue");
  if (frameworks.has("nuxt")) {
    selected.add("nuxt");
    selected.add("vue");
  }

  if (languages.has("python")) selected.add("python");
  if (languages.has("go")) selected.add("golang");
  if (languages.has("php")) selected.add("php");
  if (languages.has("ruby")) selected.add("ruby");
  if (languages.has("swift")) selected.add("swift");
  if (languages.has("arkts")) selected.add("arkts");

  return [...selected].filter((name) => RULE_PACKS.has(name));
}

export function explainRules(detection, rules) {
  const lines = [];
  lines.push("Detected stack:");
  lines.push(`- repo type: ${detection.repoType || "generic"}`);
  lines.push(`- languages: ${(detection.languages || []).join(", ") || "none detected"}`);
  lines.push(`- frameworks: ${(detection.frameworks || []).join(", ") || "none detected"}`);
  lines.push(`- tools: ${(detection.tools || []).join(", ") || "none detected"}`);
  lines.push(`- package manager: ${detection.packageManager || "unknown"}`);
  lines.push(`- monorepo: ${detection.monorepo ? "yes" : "no"}`);
  lines.push("");
  lines.push("Selected ECC rules:");
  for (const rule of rules) lines.push(`- ${rule}`);
  return lines.join("\n");
}
