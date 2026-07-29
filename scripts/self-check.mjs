import { runCliContractChecks } from "./self-check/cli-contract.mjs";
import { runCredentialChecks } from "./self-check/credentials.mjs";
import { runEccRulesAndManifestChecks } from "./self-check/ecc-rules-and-manifest.mjs";
import { runEccSourceAndTransactionChecks } from "./self-check/ecc-source-and-transaction.mjs";
import { runFilesystemChecks } from "./self-check/filesystem.mjs";
import { runGstackChecks } from "./self-check/gstack.mjs";
import { runGstackProvisionChecks } from "./self-check/gstack-provision.mjs";
import { runMcpAndSettingsChecks } from "./self-check/mcp-and-settings.mjs";
import { runProvisionAndPipelineChecks } from "./self-check/provision-and-pipelines.mjs";
import { runQualityGateChecks } from "./self-check/quality-gates.mjs";

await runMcpAndSettingsChecks();
await runEccRulesAndManifestChecks();
await runEccSourceAndTransactionChecks();
await runCliContractChecks();
await runGstackChecks();
await runProvisionAndPipelineChecks();
await runGstackProvisionChecks();
await runFilesystemChecks();
await runCredentialChecks();
await runQualityGateChecks();

console.log("self-check passed");
