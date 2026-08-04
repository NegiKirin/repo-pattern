import { runCliContractChecks } from "./self-check/cli-contract.mjs";
import { runDoctorGraphifyChecks } from "./self-check/doctor-graphify.mjs";
import { runCredentialChecks } from "./self-check/credentials.mjs";
import { runEccRulesAndManifestChecks } from "./self-check/ecc-rules-and-manifest.mjs";
import { runEccSourceAndTransactionChecks } from "./self-check/ecc-source-and-transaction.mjs";
import { runFilesystemChecks } from "./self-check/filesystem.mjs";
import { runGstackChecks } from "./self-check/gstack.mjs";
import { runGstackProvisionChecks } from "./self-check/gstack-provision.mjs";
import { installGraphifyStubs } from "./self-check/graphify-fixtures.mjs";
import { runGraphifyChecks } from "./self-check/graphify.mjs";
import { runGitProgressChecks } from "./self-check/git-progress.mjs";
import { runMcpAndSettingsChecks } from "./self-check/mcp-and-settings.mjs";
import { runProvisionAndPipelineChecks } from "./self-check/provision-and-pipelines.mjs";
import { runProgressChecks } from "./self-check/progress.mjs";
import { runQualityGateChecks } from "./self-check/quality-gates.mjs";

const removeGraphifyStubs = await installGraphifyStubs();
try {
  await runGraphifyChecks();
  await runDoctorGraphifyChecks();
  await runMcpAndSettingsChecks();
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
} finally {
  await removeGraphifyStubs();
}
