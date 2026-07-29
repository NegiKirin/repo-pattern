export { ECC_RULE_PACKS, invalidEccRules, normalizeEccRules, selectEccRules } from "./ecc-rule-registry.mjs";

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
