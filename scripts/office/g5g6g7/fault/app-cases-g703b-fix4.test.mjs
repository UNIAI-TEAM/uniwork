// G7-03b (UNI-1382) fix4: cloud round 1 failures (CL1-n). Each test was RED on 526868ff3 and is GREEN after the fix.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-g703b-fix4.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { captureRowShots } from "./app-case-drivers-offline.mjs";
import { createAppDocument } from "./app-tenant.mjs";

const FAULT_DIR = dirname(fileURLToPath(import.meta.url));

/** A tenant whose calls land on a throwaway local server that answers a created document and records every request. */
const tenantAt = () => {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const json = req.headers["content-type"]?.startsWith("application/json") && raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, path: req.url, body: json });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url.endsWith("/documents/files") ? { document: { id: "01NEWDOC", revision: "1" } } : { status: "ok" }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    requests,
    server,
    tenant: { apiOrigin: `http://127.0.0.1:${server.address().port}`, workspaceId: "01WS", owner: { token: "owner-token" }, app: { userId: "01APPUSER" } },
  })));
};

test("CL1-1: a new app document is shared with the app account at edit level right after creation (SH-S1 creates it private)", async () => {
  const { requests, server, tenant } = await tenantAt();
  try {
    const doc = await createAppDocument(tenant, { bytes: Buffer.from("x"), mime: "text/plain", path: "/fixtures/a.docx" }, "FL-01 run 1");
    assert.deepEqual(doc, { id: "01NEWDOC", revision: "1" });
    assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`), ["POST /api/v1/workspaces/01WS/documents/files", "POST /api/v1/documents/01NEWDOC/shares"]);
    assert.deepEqual(requests[1].body, { principal_type: "user", principal_id: "01APPUSER", level: "edit" });
  } finally {
    server.close();
  }
});

test("CL1-1: a failed create shares nothing, a failed share is raised (the row never opens a document the app cannot see)", async () => {
  const calls = [];
  const tenant = { app: { userId: "01APPUSER" } };
  await assert.rejects(
    createAppDocument(tenant, {}, "t", { create: async () => { throw new Error("create down"); }, share: async () => calls.push("share") }),
    /create down/,
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    createAppDocument(tenant, {}, "t", { create: async () => ({ id: "D" }), share: async () => { throw new Error("share refused"); } }),
    /share refused/,
  );
});

test("CL1-1: ctx.newDocument of the runner goes through createAppDocument, not the bare upload", () => {
  const source = readFileSync(join(FAULT_DIR, "app-cases.mjs"), "utf8");
  assert.match(source, /await createAppDocument\(tenant, fixture,/);
  assert.doesNotMatch(source, /await createFileDocument\(/);
});

test("CL1-2: a declared shot that did not capture while the app is alive reads 'not captured', not 'the app died'", async () => {
  const session = { shell: { waitForSelector: async () => { throw new Error("no such selector"); } } };
  const ctx = { appAlive: async () => true, artifactPath: (name) => join(FAULT_DIR, "never-written", name) };
  const [shot] = await captureRowShots(ctx, session, { s11: true });
  assert.equal(shot.name, "s11_shot");
  assert.equal(shot.ok, false);
  assert.equal(shot.actual, "not captured");
});

test("CL1-2: the same capture on a dead app is still BLOCKED, never a FAIL", async () => {
  const session = { shell: { waitForSelector: async () => { throw new Error("gone"); } } };
  const ctx = { appAlive: async () => false, artifactPath: (name) => join(FAULT_DIR, "never-written", name) };
  await assert.rejects(captureRowShots(ctx, session, { s11: true }), /the app stopped before s11-lock-panel\.png could be captured/);
});
