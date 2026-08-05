import { runCliContractChecks } from "./self-check/cli-contract.mjs";
import { runCredentialChecks } from "./self-check/credentials.mjs";
import { runEccRulesAndManifestChecks } from "./self-check/ecc-rules-and-manifest.mjs";
import { runEccSourceAndTransactionChecks } from "./self-check/ecc-source-and-transaction.mjs";
import { runFilesystemChecks } from "./self-check/filesystem.mjs";
import { runGstackChecks } from "./self-check/gstack.mjs";
import { runGstackProvisionChecks } from "./self-check/gstack-provision.mjs";
import { runGitProgressChecks } from "./self-check/git-progress.mjs";
import { runMcpAndSettingsChecks } from "./self-check/mcp-and-settings.mjs";
import { runMcpProfileChecks } from "./self-check/mcp-profiles.mjs";
import { runProvisionAndPipelineChecks } from "./self-check/provision-and-pipelines.mjs";
import { runProgressChecks } from "./self-check/progress.mjs";
import { runQualityGateChecks } from "./self-check/quality-gates.mjs";

await runMcpAndSettingsChecks();
await runMcpProfileChecks();
await runEccRulesAndManifestChecks();
await runEccSourceAndTransactionChecks();
await runCliContractChecks();
await runGstackChecks();
await runProvisionAndPipelineChecks();
await runGstackProvisionChecks();
await runGitProgressChecks();
await runProgressChecks();
await runFilesystemChecks();
await runCredentialChecks();
await runQualityGateChecks();

console.log("self-check passed");
