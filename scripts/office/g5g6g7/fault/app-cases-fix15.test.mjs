// FIX-15 (UNI-1380 G7-03a, round 12c): FQ-51's session_expired exit needs the
// session to really expire — a 401 on the commit alone is cured by the app's own
// silent refresh, so the fault must kill that refresh too.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix15.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FQ51_SESSION_RULES } from "./app-case-drivers-blocked.mjs";
import { renderCaseRules } from "./server-cases-lib.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const cases = JSON.parse(readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/cases.json"), "utf8")).cases;
const row = (id) => cases.find((r) => r.id === id);

test("FQ-51 carries both rules and renders them with no fault rewritten", () => {
  const fq51 = row("FQ-51");
  const ids = fq51.proxyRules.map((r) => r.id);
  for (const id of FQ51_SESSION_RULES) assert.ok(ids.includes(id), `FQ-51 has no rule ${id}`);
  const rendered = renderCaseRules({ ...fq51, proxyRules: fq51.proxyRules.filter((r) => FQ51_SESSION_RULES.includes(r.id)) }, {});
  assert.equal(rendered.length, 2);
  const dead = rendered.find((r) => r.id === "fake-refresh-401");
  assert.equal(dead.match.method, "POST");
  assert.equal(dead.match.path, "^/api/v1/auth/desktop/refresh$");
  assert.equal(dead.action.type, "status");
  assert.equal(dead.action.code, 401);
  // the server's own verdict for a revoked device session: the client reads the
  // 401 as session_expired (fork errors.ts:144, client.ts:96-102), clears the
  // credential and offers the desktop login again
  assert.equal(dead.action.body.error.code, "device_revoked");
  assert.equal(dead.once, true, "the failed refresh is the old session's answer, once");
  assert.equal(rendered.find((r) => r.id === "fake-401").action.code, 401);
});

test("the matrix row names FQ-51's dead refresh and the re-auth precondition", () => {
  const matrix = readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/matrix.md"), "utf8");
  const line = matrix.split(/\r?\n/).find((l) => l.startsWith("| FQ-51 |"));
  assert.match(line, /`fake-refresh-401`: POST \/api\/v1\/auth\/desktop\/refresh → status 401/);
  assert.match(line, /`signed_out_before_sign_in`/);
});
