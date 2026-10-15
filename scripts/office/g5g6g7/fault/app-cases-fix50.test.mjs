// FIX-15 (UNI-1380 G7-03a, round 12c): FQ-50's permission_revoked exit revokes a
// *permission*, not a workspace membership — the server answers a non-member 404
// not_found by product rule, and only a 403 forbidden becomes the client's
// `permission_revoked` (so the case downgrades the document's own share).
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fix50.test.mjs
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CONDITIONS } from "./app-case-drivers-blocked.mjs";

const FAULT_DIR = fileURLToPath(new URL(".", import.meta.url));
const cases = JSON.parse(readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/cases.json"), "utf8")).cases;
const row = (id) => cases.find((r) => r.id === id);

/** A tenant whose calls land on a throwaway local server, recording every request. */
const tenantAt = () => {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.method === "GET" ? { document: { revision: "7" } } : { status: "ok" }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    requests,
    server,
    tenant: { apiOrigin: `http://127.0.0.1:${server.address().port}`, owner: { token: "owner-token" }, app: { userId: "01APPUSER" } },
  })));
};

test("FQ-50 permission_revoked: prepare restricts the document and shares it at edit", async () => {
  const { requests, server, tenant } = await tenantAt();
  try {
    await CONDITIONS.permission_revoked.prepare({ tenant }, "01DOC");
    assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), ["GET /api/v1/documents/01DOC", "PATCH /api/v1/documents/01DOC", "POST /api/v1/documents/01DOC/shares"]);
    // manage-only field, guarded by the head revision (document_pages.go:535-550)
    assert.deepEqual(requests[1].body, { revision: "7", visibility: "restricted" });
    assert.deepEqual(requests[2].body, { principal_type: "user", principal_id: "01APPUSER", level: "edit" });
  } finally {
    server.close();
  }
});

test("FQ-50 permission_revoked: set downgrades the same share to view, lift restores edit", async () => {
  const { requests, server, tenant } = await tenantAt();
  try {
    await CONDITIONS.permission_revoked.set({ tenant }, "01DOC");
    await CONDITIONS.permission_revoked.lift({ tenant }, "01DOC");
    assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), ["POST /api/v1/documents/01DOC/shares", "POST /api/v1/documents/01DOC/shares"]);
    assert.deepEqual(requests.map((r) => r.body.level), ["view", "edit"]);
    // the app keeps read through the share, so a save is refused with 403
    // forbidden (access below edit: document_permissions.go:297-299) and never
    // with the 404 a non-member gets
    for (const request of requests) assert.equal(request.body.principal_type, "user");
  } finally {
    server.close();
  }
});

test("FQ-50's other exits keep their own conditions and carry the fix17 per-exit tags", () => {
  assert.deepEqual(Object.keys(CONDITIONS).sort(), ["document_archived", "document_deleted", "member_deactivated", "organization_suspended", "permission_revoked"]);
  assert.equal(CONDITIONS.permission_revoked.prepare.length, 2, "prepare takes (ctx, docId)");
  assert.equal(CONDITIONS.permission_revoked.set.length, 2, "set takes (ctx, docId)");
  assert.equal(CONDITIONS.permission_revoked.lift.length, 2, "lift takes (ctx, docId)");
  // FIX-17 (Advisor qa-fault_local:46): the exits are tagged now - OQ-F12 on the four
  // condition lifts the queue machine never makes, OQ-F6 on the two 403 exits
  assert.deepEqual(row("FQ-50").exits.map((e) => e.predicted), ["OQ-F12", "OQ-F6", "OQ-F6", "OQ-F12", "OQ-F12"]);
});

test("the matrix row names FQ-50's permission downgrade and the 403 it produces", () => {
  const matrix = readFileSync(join(FAULT_DIR, "../../../../docs/office/g5g6g7/fault/matrix.md"), "utf8");
  const line = matrix.split(/\r?\n/).find((l) => l.startsWith("| FQ-50 |"));
  assert.match(line, /tài liệu `restricted` \+ share `edit` của app/);
  assert.match(line, /403 `forbidden`/);
  assert.match(line, /`document_permissions\.go:290-301`/);
});
