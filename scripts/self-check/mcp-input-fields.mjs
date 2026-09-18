import assert from "node:assert/strict";
import { mcpInputFields } from "../lib/mcp.mjs";

export async function runMcpInputFieldsChecks() {
  assert.deepEqual(mcpInputFields({
    context7: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" }, args: ["${PROJECT_DIR:-.}"] },
    duplicate: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" } }
  }), [
    { name: "CONTEXT7_API_KEY", defaultValue: "", kind: "secret", label: "context7: CONTEXT7_API_KEY" },
    { name: "PROJECT_DIR", defaultValue: ".", kind: "path", label: "context7: PROJECT_DIR" }
  ]);
}
