export const ECC_RULE_REGISTRY = [
  { name: "common", matches: () => true },
  { name: "angular", matches: ({ frameworks }) => frameworks.has("angular") },
  { name: "arkts", matches: ({ languages }) => languages.has("arkts") },
  { name: "cpp", matches: ({ languages }) => languages.has("cpp") },
  { name: "csharp", matches: ({ languages }) => languages.has("csharp") },
  { name: "dart", matches: ({ languages }) => languages.has("dart") },
  { name: "fsharp", matches: ({ languages }) => languages.has("fsharp") },
  { name: "golang", matches: ({ languages }) => languages.has("go") },
  { name: "java", matches: ({ languages }) => languages.has("java") },
  { name: "kotlin", matches: ({ languages }) => languages.has("kotlin") },
  { name: "nuxt", matches: ({ frameworks }) => frameworks.has("nuxt") },
  { name: "perl", matches: ({ languages }) => languages.has("perl") },
  { name: "php", matches: ({ languages }) => languages.has("php") },
  { name: "python", matches: ({ languages }) => languages.has("python") },
  { name: "react", matches: ({ frameworks }) => frameworks.has("react") },
  { name: "react-native", matches: ({ frameworks }) => frameworks.has("react-native") },
  { name: "ruby", matches: ({ languages }) => languages.has("ruby") },
  { name: "rust", matches: ({ languages }) => languages.has("rust") },
  { name: "swift", matches: ({ languages }) => languages.has("swift") },
  { name: "typescript", matches: ({ languages, hasFrontend }) => languages.has("javascript") || languages.has("typescript") || hasFrontend },
  { name: "vue", matches: ({ frameworks }) => frameworks.has("vue") || frameworks.has("nuxt") },
  { name: "web", matches: ({ hasFrontend }) => hasFrontend }
];

export const ECC_RULE_PACKS = ECC_RULE_REGISTRY.map(({ name }) => name);
const RULE_PACKS = new Set(ECC_RULE_PACKS);

export function normalizeEccRules(rules = []) {
  return [...new Set(rules)].filter((name) => RULE_PACKS.has(name));
}

export function invalidEccRules(rules = []) {
  return [...new Set(rules)].filter((name) => !RULE_PACKS.has(name));
}

export function selectEccRules(detection) {
  const languages = new Set(detection.languages || []);
  const frameworks = new Set(detection.frameworks || []);
  const tools = new Set(detection.tools || []);
  const hasFrontend = frameworks.has("nextjs") || frameworks.has("react") || frameworks.has("react-native") ||
    frameworks.has("angular") || frameworks.has("vue") || frameworks.has("nuxt") ||
    tools.has("frontend-tooling") || detection.repoType === "frontend" || detection.repoType === "fullstack";
  return ECC_RULE_REGISTRY.filter(({ matches }) => matches({ languages, frameworks, tools, repoType: detection.repoType, hasFrontend }))
    .map(({ name }) => name);
}
