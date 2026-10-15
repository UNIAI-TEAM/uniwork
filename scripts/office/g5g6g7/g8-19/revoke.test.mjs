// g8-19/revoke.mjs (UNI-1414, G8-A07 "quyền kiểm lúc mở; snippet ẩn khi mất
// quyền"): a share revoked while B has the document open on web and desktop
// locks the desktop panel, the REST list and the deep link, and hides the
// notification snippet; archiving answers resource_deleted. decideRevoke.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { createFakeWorld, serverCommentCreateRefusal } from "./fake-world.mjs";
import { LOCKED_DESKTOP_CODES, REVOKED_NO_ACCESS_OWNER, decideRevoke, runRevoke } from "./revoke.mjs";
import { rowArtifactPath, runRowModule } from "./run-row.mjs";

const notif = (extra = {}) => ({
  id: "n1",
  kind: "document_mentioned",
  resource_type: "document",
  resource_id: "doc-1",
  params: { comment_id: "c1", kind: "comment", actor: "G8 A", document: "Báo cáo", snippet: "Xem giúp" },
  resource_deleted: false,
  resource_access_lost: false,
  comment_deleted: false,
  ...extra,
});
const lostParams = { comment_id: "c1", kind: "comment", actor: "G8 A" };

const record = (extra = {}) => ({
  before: { desktop: { ok: true, value: { comments: [] } }, web: { status: "ok" }, notification: notif() },
  after: {
    desktop: { ok: false, error: { code: "forbidden", message: "x" } },
    rest: { status: 403 },
    web: { status: "no-access" },
    notification: notif({ resource_access_lost: true, params: lostParams }),
  },
  archive: {
    notification: notif({ resource_id: "doc-2", resource_deleted: true, params: lostParams }),
    web: { status: "not-found" },
  },
  ...extra,
});
const withAfter = (after) => record({ after: { ...record().after, ...after } });

test("LOCKED_DESKTOP_CODES are the fork's verdicts for a refused list (fork apps/shell/src/main/uniwork-docs/errors.ts:130,142-143)", () => {
  assert.deepEqual([...LOCKED_DESKTOP_CODES].sort(), ["forbidden", "not_found", "permission_revoked"]);
});

test("decideRevoke: desktop forbidden, REST 403, deep link no-access, snippet gone + resource_access_lost, archive resource_deleted -> PASS", () => {
  const out = decideRevoke(record());
  assert.equal(out.status, "PASS", JSON.stringify(out.checks));
  assert.deepEqual(Object.keys(out.checks).sort(), ["archive", "before", "desktop-locked", "rest-locked", "snippet-hidden", "web-no-access"]);
  // 404 hides existence just as well (CLAUDE.md Backend ID rules)
  assert.equal(decideRevoke(withAfter({ rest: { status: 404 }, desktop: { ok: false, error: { code: "not_found" } } })).status, "PASS");
  assert.equal(decideRevoke(withAfter({ desktop: { ok: false, error: { code: "permission_revoked" } } })).status, "PASS");
});

test("decideRevoke: the desktop panel still lists, or fails for another reason (offline) -> FAIL", () => {
  assert.equal(decideRevoke(withAfter({ desktop: { ok: true, value: { comments: [] } } })).status, "FAIL");
  const offline = decideRevoke(withAfter({ desktop: { ok: false, error: { code: "offline" } } }));
  assert.equal(offline.status, "FAIL");
  assert.match(offline.checks["desktop-locked"].reason, /offline/);
});

test("decideRevoke: REST still 200, or the deep link still opens -> FAIL", () => {
  assert.equal(decideRevoke(withAfter({ rest: { status: 200 } })).status, "FAIL");
  assert.equal(decideRevoke(withAfter({ web: { status: "ok" } })).status, "FAIL");
  assert.equal(decideRevoke(withAfter({ web: { status: "not-found" } })).status, "FAIL");
});

test("decideRevoke: the S15 gone page for a row that reads resource_access_lost is a product FAIL naming the D page, the server 404 and an owner", () => {
  const out = decideRevoke(withAfter({ web: { status: "not-found" } }));
  const reason = out.checks["web-no-access"].reason;
  assert.match(reason, /^product: /);
  assert.match(reason, /resource_access_lost/);
  assert.match(reason, /EXPERIENCE-G8\.md S15 row 2/);
  assert.match(reason, /document-detail-view\.tsx:92-93/);
  assert.match(reason, /document_permissions\.go/);
  assert.match(reason, /owner candidate Lead D/);
  assert.equal(REVOKED_NO_ACCESS_OWNER, "owner candidate Lead D (G8-07 deep link: D web Inbox row / document page)");
  // a row that does not read resource_access_lost gives the page nothing to go on: no product claim
  const noFlag = decideRevoke(withAfter({ web: { status: "not-found" }, notification: notif({ resource_access_lost: false, params: lostParams }) }));
  assert.doesNotMatch(noFlag.checks["web-no-access"].reason, /^product: /);
});

test("decideRevoke: a snippet or document name left on the row, or no resource_access_lost -> FAIL", () => {
  assert.equal(decideRevoke(withAfter({ notification: notif({ resource_access_lost: true, params: { ...lostParams, snippet: "Xem" } }) })).status, "FAIL");
  assert.equal(decideRevoke(withAfter({ notification: notif({ resource_access_lost: true, params: { ...lostParams, document: "Báo cáo" } }) })).status, "FAIL");
  assert.equal(decideRevoke(withAfter({ notification: notif({ resource_access_lost: false, params: lostParams }) })).status, "FAIL");
  assert.equal(decideRevoke(withAfter({ notification: null })).status, "FAIL");
});

test("decideRevoke: the precondition (open and listing, snippet shown) must hold before the revoke", () => {
  assert.equal(decideRevoke(record({ before: { ...record().before, desktop: { ok: false, error: { code: "forbidden" } } } })).status, "FAIL");
  assert.equal(decideRevoke(record({ before: { ...record().before, notification: notif({ params: lostParams }) } })).status, "FAIL");
});

test("decideRevoke: archive must answer resource_deleted without the snippet and the S15 gone state; a missing archive step -> FAIL", () => {
  assert.equal(decideRevoke(record({ archive: { notification: notif({ resource_deleted: false, params: lostParams }), web: { status: "not-found" } } })).status, "FAIL");
  assert.equal(decideRevoke(record({ archive: { notification: notif({ resource_deleted: true }), web: { status: "not-found" } } })).status, "FAIL");
  assert.equal(decideRevoke(record({ archive: { notification: notif({ resource_deleted: true, params: lostParams }), web: { status: "ok" } } })).status, "FAIL");
  assert.equal(decideRevoke(record({ archive: null })).status, "FAIL");
  assert.equal(decideRevoke({}).status, "FAIL");
});

// ---- the module flow against the fake world --------------------------------------------------------

let runDir;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-revoke-"));
  writeFileSync(join(runDir, "ports.env"), "API_ORIGIN=http://127.0.0.1:9\nWEB_ORIGIN=http://127.0.0.1:8\nOFFICE_FORK_SHA=7d665a54\n");
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "up" }));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

function scripted({ leakSnippet = false, desktopStillLists = false } = {}) {
  const fake = createFakeWorld();
  const { world, script } = fake;
  const comments = new Map();
  const archived = new Set();
  let seq = 0;
  const revoked = (documentId) => Object.values(world.shares).some((s) => s.documentId === documentId && s.revoked);
  script.respond("api.createDocumentComment", (call) => {
    const refused = serverCommentCreateRefusal(call.args.body);
    if (refused) return refused;
    seq += 1;
    comments.set(`c${seq}`, { documentId: call.args.pathParams.documentID, body: call.args.body.body });
    return { status: 201, body: { comment: { id: `c${seq}` } } };
  });
  script.respond("api.archiveDocument", (call) => {
    archived.add(call.args.pathParams.documentID);
    return { status: 200, body: {} };
  });
  script.respond("api.mintLaunch", { status: 201, body: { launch_ticket: "ticket_x", launch_url: "uniwork-office-dev://open?ticket=ticket_x" } });
  script.respond("api.listDocumentComments", (call) => (revoked(call.args.pathParams.documentID) ? { status: 403, body: { error: "forbidden" } } : { status: 200, body: { comments: [] } }));
  script.respond("app.openByTicket", (call) => ({ path: `/fake/${call.args[1]?.documentId}`, documentId: call.args[1]?.documentId ?? null, kind: "docs" }));
  script.respond("app.comments.list", (call) =>
    revoked(call.args[0].path.slice("/fake/".length)) && !desktopStillLists ? { ok: false, error: { code: "forbidden", message: "x" } } : { ok: true, value: { comments: [] } },
  );
  script.respond("api.listNotifications", (call) => {
    if (call.user !== "B") return { status: 200, body: { notifications: [] } };
    const rows = [...comments.entries()]
      .filter(([, c]) => c.body.includes("mention://member/user-B"))
      .map(([id, c]) => {
        const gone = archived.has(c.documentId);
        const lost = revoked(c.documentId);
        const hide = (gone || lost) && !leakSnippet;
        return {
          id: `n-${id}`,
          kind: "document_mentioned",
          resource_type: "document",
          resource_id: c.documentId,
          params: hide ? { comment_id: id, kind: "comment" } : { comment_id: id, kind: "comment", snippet: "s", document: "D" },
          resource_deleted: gone,
          resource_access_lost: lost && !gone,
          comment_deleted: false,
        };
      });
    return { status: 200, body: { notifications: rows } };
  });
  const web = {
    webLogin: fake.web.webLogin,
    openDocument: async (_page, opts) => {
      if (archived.has(opts.documentId)) return { url: "u", status: "not-found", panelCount: 0, focusedCommentId: null };
      if (revoked(opts.documentId)) return { url: "u", status: "no-access", panelCount: 0, focusedCommentId: null };
      return { url: "u", status: "ok", panelCount: 1, focusedCommentId: opts.comment ?? null };
    },
  };
  return { fake, deps: { web, connectApp: fake.app.connectApp, launchBrowser: async () => fake.browser, sleep: async () => {}, pollMs: 0, pollTimeoutMs: 50 } };
}

const run = ({ fake, deps }) =>
  runRowModule({ row: "G8-A07", fixture: "fx-docx-report-vi", runDir, module: "revoke", timeoutMs: 10_000, worldFactory: () => fake.world }, (ctx) => runRevoke(ctx, deps));
const artifact = () => JSON.parse(readFileSync(rowArtifactPath(runDir, "G8-A07", "fx-docx-report-vi"), "utf8"));

test("runRevoke: B open on both hosts, A revokes mid-session, then archives -> PASS", async () => {
  const s = scripted();
  const exit = await run(s);
  const a = artifact();
  assert.equal(exit, 0, JSON.stringify(a, null, 1));
  assert.equal(a.module, "revoke");
  // the revoke is A's, on the W1 document shared to B only
  const revokes = s.fake.calls.world.filter((c) => c.key === "revokeShare");
  assert.equal(revokes.length, 1);
  assert.equal(revokes[0].args[0], "A");
  const shared = s.fake.world.docs[revokes[0].args[1]];
  assert.equal(shared.workspaceKey, "W1");
  // B opened it on the desktop before the revoke
  const order = s.fake.calls.all.map((c) => c.key);
  assert.ok(order.indexOf("openByTicket") < order.indexOf("revokeShare"));
});

test("runRevoke: a snippet that survives the revoke, or a desktop panel that keeps listing -> FAIL", async () => {
  assert.equal(await run(scripted({ leakSnippet: true })), 1);
  assert.equal(artifact().steps.revoke.status, "FAIL");
  assert.equal(await run(scripted({ desktopStillLists: true })), 1);
});
