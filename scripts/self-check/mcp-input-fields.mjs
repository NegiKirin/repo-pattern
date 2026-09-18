import assert from "node:assert/strict";
import { mcpInputFields } from "../lib/mcp.mjs";

export async function runMcpInputFieldsChecks() {
  const fields = mcpInputFields({
    context7: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" }, args: ["${PROJECT_DIR:-.}"] },
    duplicate: { env: { CONTEXT7_API_KEY: "${CONTEXT7_API_KEY}" } }
  });
  assert.deepEqual(fields.map(({ validate: _validate, ...field }) => field), [
    { name: "CONTEXT7_API_KEY", defaultValue: "", kind: "secret", label: "context7: CONTEXT7_API_KEY", placeholder: "ctx7sk-....................." },
    { name: "PROJECT_DIR", defaultValue: ".", kind: "path", label: "context7: PROJECT_DIR" }
  ]);
  assert.equal(fields[0].validate(""), "Required");
  assert.equal(fields[0].validate("ctx7sk-valid"), true);
}
