import { printBox, style } from "./prompt.mjs";

const GROUPS = ["Workspace", "Settings & MCP", "ECC", "gstack"];

function repairFor(label, target) {
  if (label.includes("not tracked")) return `Stop tracking this file and retain the local copy; deleting it is not required. If credentials were committed, revoke and rotate them. Never delete local config as a substitute.`;
  if (label.includes(".repo-pattern/.repo-pattern.json")) return `Initialize repo-pattern with repo-pattern setup --target ${quoteTarget(target)} --yes, or restore valid metadata from backup.`;
  if (label.includes("lock.json")) return `Restore the lock file from backup or rerun repo-pattern setup --target ${quoteTarget(target)} --yes after reviewing local configuration.`;
  if (label.includes("settings.json") || label.includes(".mcp.json")) return `Review and repair this generated configuration from the project's selected setup; do not copy credentials into tracked files.`;
  if (label.includes(".claude exists")) return `Restore the .claude workspace directory from backup, or initialize repo-pattern with repo-pattern setup --target ${quoteTarget(target)} --yes.`;
  if (label.includes(".claude/skills") || label.includes(".claude/commands") || label.includes(".claude/hooks") || label.includes(".claude/scripts")) return `Move the unexpected runtime item only after confirming it is not project-owned; rerun repo-pattern setup --target ${quoteTarget(target)} --yes if this project should be initialized.`;
  if (label.includes("gstack")) return `Review the local gstack installation; rerun repo-pattern setup --target ${quoteTarget(target)} --yes only if that pipeline is intended.`;
  if (label.includes("ECC") || label.includes("ecc")) return `Restore the expected repo-pattern-managed ECC rules/agents, or rerun repo-pattern setup --target ${quoteTarget(target)} --yes if ECC is intended.`;
  return `Repair by restoring the expected workspace path or removing only confirmed unmanaged runtime items.`;
}

function safeText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function quoteTarget(target) {
  return `'${safeText(target).replaceAll("'", "'\\''")}'`;
}

export function renderDoctor({ target, setupPipeline, checks, infoRows, verbose }) {
  const failed = checks.filter((row) => !row.ok);
  const status = failed.length ? "FAIL" : "PASS";
  const groups = GROUPS.map((name) => {
    const rows = checks.filter((row) => row.group === name);
    const groupStatus = rows.some((row) => !row.ok) ? "FAIL" : rows.length ? "PASS" : "N/A";
    return { name, rows, status: groupStatus };
  });
  const warnings = infoRows.filter((row) => /browser skipped|plugin installation is required|^\/plugin |Project permissions\.defaultMode=bypassPermissions/.test(row));
  const information = infoRows.filter((row) => !warnings.includes(row));
  const lines = [
    `Target  ${safeText(target)}`,
    `Pipeline  ${safeText(setupPipeline)}`,
    `Status  ${status} · ${checks.length - failed.length} passed, ${failed.length} failed, ${checks.length} total`,
    "",
    ...groups.map(({ name, rows, status: groupStatus }) => `${name}  ${groupStatus} · ${rows.length - rows.filter((row) => !row.ok).length} passed, ${rows.filter((row) => !row.ok).length} failed, ${rows.length} total`),
    "",
    ...(failed.length ? ["Issues", ...failed.map((row) => `✗ ${safeText(row.label)}\n  Why: ${safeText(row.reason || "The expected workspace condition is not met.")}\n  Repair: ${safeText(repairFor(row.label, target))}`)] : []),
    ...(warnings.length ? ["Warnings", ...warnings.map((row) => `! ${safeText(row)}`)] : []),
    ...(information.length ? ["Information", ...information.map((row) => `i ${safeText(row)}`)] : []),
    ...(!verbose && !failed.length ? ["Run repo-pattern doctor --verbose to show successful checks."] : [])
  ];
  if (verbose) lines.push("", "Detailed checks", ...groups.filter(({ rows }) => rows.length).flatMap(({ name, rows }) => [safeText(name), ...rows.map((row) => `${row.ok ? "✓" : "✗"} ${safeText(row.label)}`)]));
  printBox("Doctor", lines);
}

export function printDoctor(report) {
  renderDoctor(report);
}

export function printAudit(audit) {
  const warning = style("error", "⚠");
  const rows = [`Target  ${safeText(audit.target)}`, `State   ${safeText(audit.state)}`];
  const needsSetup = audit.state !== "EMPTY";
  const issues = [
    [needsSetup && !audit.hasClaudeDir, ".claude missing"],
    [needsSetup && !audit.hasMcpJson, ".mcp.json missing"],
    [needsSetup && !audit.hasRepoPatternJson, ".repo-pattern/.repo-pattern.json missing"],
    [audit.hasHardcodedMcpPath, "hardcoded machine path in .mcp.json"],
    [audit.hasSettingsLocalTracked, ".claude/settings.local.json tracked"],
    [audit.hasSettingsHooks && audit.repoPattern?.workflow !== "gstack" && audit.repoPattern?.workflow !== "ecc-gstack", ".claude/settings.json hooks not empty"],
    [audit.gstack && !audit.gstack.checkoutValid, "project-local gstack checkout is missing or invalid"],
    [audit.gstack && !audit.gstack.stateValid, "project-local gstack state is missing"],
    [audit.gstack && !audit.gstack.wrappersValid, "project-local gstack wrappers have drifted"],
    [audit.gstack && !audit.gstack.assetsValid, "project-local gstack workflow assets have drifted"],
    [audit.gstack && !audit.gstack.sidecarsValid, "project-local gstack review sidecars have drifted"],
    [audit.lock?.gstack?.status === "failed", "project-local gstack bootstrap failed"],
    [audit.repoPattern?.runtime?.localSkills === true && !audit.hasOnlyManagedSkills, ".claude/skills does not match managed optional skills"],
    [audit.hasClaudeSkillsDir && !audit.hasOnlyManagedSkills, ".claude/skills contains unmanaged entries"],
    [audit.hasClaudeCommandsDir, ".claude/commands present"],
    [audit.hasClaudeHooksDir, ".claude/hooks present"],
    [audit.hasClaudeScriptsDir, ".claude/scripts present"],
    [audit.hasClaudeRulesDir && !audit.hasOnlyEccRulesDir, "non-ECC .claude/rules present"],
    [audit.hasClaudeEccRulesDir && !audit.hasManagedEccRules, ".claude/rules/ecc is not repo-pattern-managed"],
    [audit.hasManagedEccAgents && !audit.hasClaudeAgentsDir, ".claude/agents is missing for repo-pattern-managed ECC agents"],
    [audit.hasClaudeAgentsDir && !audit.hasManagedEccAgents, ".claude/agents is not repo-pattern-managed"]
  ].filter(([bad]) => bad);
  if (issues.length > 0) rows.push("", ...issues.map(([, message]) => `${warning} ${message}`));
  printBox("Audit", rows);
}
