// The fake world honours the harness contract (g8-contract.md): the same
// shapes, the same validation, the scripting and the recording that T2-T4
// rely on to write red tests with no server.
import assert from "node:assert/strict";
import { test } from "node:test";

import { G8_API_CALLS } from "../harness/api-contract.mjs";
import { COMMENTS_API_NAMES, DISCUSSION_API_NAMES } from "../harness/app.mjs";
import { SQL_MEMBERSHIP_BLOCKER } from "../harness/world.mjs";
import { FAKE_TIMEOUT, bridgeCommentCreateRefusal, createFakeWorld, fakeNetworkError, serverCommentCreateRefusal } from "./fake-world.mjs";
import {
  B7_ANCHOR,
  ROW_EXIT,
  decideFromSteps,
  exitCodeFor,
  parseRowArgs,
  rowArtifactPath,
} from "./run-row.mjs";

test("the world has the §2 keys: users A B C M, org X (W1 W2) owned by A, org Y (WY) owned by M", () => {
  const { world } = createFakeWorld();
  assert.deepEqual(Object.keys(world.users).sort(), ["A", "B", "C", "M"]);
  for (const u of Object.values(world.users)) {
    for (const field of ["key", "id", "email", "password", "token", "displayName"]) assert.equal(typeof u[field], "string", `${u.key}.${field}`);
  }
  assert.deepEqual(Object.keys(world.org("X").workspaces).sort(), ["W1", "W2"]);
  assert.deepEqual(Object.keys(world.org("Y").workspaces), ["WY"]);
  assert.equal(world.org("X").ownerKey, "A");
  assert.equal(world.org("Y").ownerKey, "M");
  assert.equal(typeof world.workspace("X", "W2").slug, "string");
  assert.throws(() => world.user("Z"), /no user Z/);
});

test("M's second org is SEEDED via sql, or a BLOCKED marker naming the blocker when SQL is not allowed", () => {
  assert.equal(createFakeWorld().world.users.M.multiOrg.status, "SEEDED");
  assert.match(createFakeWorld().world.users.M.multiOrg.reason, /ADR 0032/);
  assert.deepEqual(createFakeWorld({ sqlMembership: false }).world.users.M.multiOrg, { status: "BLOCKED", blocker: SQL_MEMBERSHIP_BLOCKER });
});

test("world methods: upload/share/revokeShare/deactivate/cleanup return the §3 shapes and are recorded", async () => {
  const { world, calls } = createFakeWorld();
  const up = await world.upload("A", "W1", "fx-docx-report-vi");
  assert.deepEqual(Object.keys(up).sort(), ["documentId", "filename", "versionId"]);
  assert.equal(world.docs[up.documentId].orgKey, "X");
  const { shareId } = await world.share("A", up.documentId, world.users.B.id, "view");
  assert.equal(world.shares[shareId].revoked, false);
  await world.revokeShare("A", up.documentId, shareId);
  assert.equal(world.shares[shareId].revoked, true);
  assert.ok("status" in (await world.deactivate("A", "X", world.users.C.id)));
  assert.deepEqual(await world.cleanup(), { leftovers: [] });
  assert.deepEqual(calls.world.map((c) => c.key), ["upload", "share", "revokeShare", "deactivate", "cleanup"]);
});

test("refreshTokens gives every user a new token and the sessions read it per call", async () => {
  const { world, script, calls } = createFakeWorld();
  const s = world.session("B");
  const before = world.users.B.token;
  await world.refreshTokens();
  assert.notEqual(world.users.B.token, before);
  script.respond("api.listNotifications", { status: 200, body: {} });
  await s.call("listNotifications");
  assert.equal(s.user.token, world.users.B.token);
  assert.equal(calls.world.at(-1).key, "refreshTokens");
});

test("connectApp can be scripted to reject with the appUnavailable classification", async () => {
  const { app, script } = createFakeWorld();
  script.queue("app.connectApp", Object.assign(new Error("no keyring"), { appUnavailable: { status: "BLOCKED", reason: "no keyring" } }));
  await assert.rejects(app.connectApp({}), (err) => err.appUnavailable.status === "BLOCKED");
});

test("a world method can be scripted to fail", async () => {
  const { world, script } = createFakeWorld();
  script.queue("world.share", new Error("403 forbidden"));
  await assert.rejects(world.share("A", "doc-1", "user-B", "view"), /403/);
});

test("api: unscripted -> 501 fake_unscripted; scripted answers; never throws on 4xx; FAKE_TIMEOUT and network errors resolve status 0", async () => {
  const { world, script, calls } = createFakeWorld();
  const b = world.session("B");
  assert.equal(b.userKey, "B");
  assert.deepEqual(await b.call("listNotifications"), { status: 501, ok: false, body: { error: "fake_unscripted", name: "listNotifications" } });
  script.respond("api.listNotifications", { status: 200, body: { notifications: [] } });
  assert.deepEqual(await b.call("listNotifications"), { status: 200, ok: true, body: { notifications: [] } });
  script.queue("api.getDocument", { status: 403, body: { error: "forbidden" } });
  assert.deepEqual(await b.call("getDocument", { documentID: "doc-1" }), { status: 403, ok: false, body: { error: "forbidden" } });
  script.queue("api.getDocument", FAKE_TIMEOUT);
  assert.deepEqual(await b.call("getDocument", { documentID: "doc-1" }), { status: 0, ok: false, body: null, error: "timeout" });
  script.queue("api.getDocument", fakeNetworkError("ECONNREFUSED"));
  assert.equal((await b.call("getDocument", { documentID: "doc-1" })).error, "ECONNREFUSED");
  // a function answer sees the recorded call
  script.queue("api.createDocumentComment", (call) => ({ status: 201, body: { comment: { id: "c-1", body: call.args.body.body } } }));
  const created = await b.call("createDocumentComment", { documentID: "doc-1" }, { body: "hi", kind: "comment" });
  assert.equal(created.body.comment.body, "hi");
  const last = calls.api.at(-1);
  assert.equal(last.user, "B");
  assert.equal(last.method, "POST");
  assert.equal(last.path, "/api/v1/documents/doc-1/comments");
});

test("api: programming errors throw like the real session (unknown name, bad params, unknown body key)", async () => {
  const { world } = createFakeWorld();
  const a = world.session("A");
  await assert.rejects(a.call("nope"), /unknown API call/);
  await assert.rejects(a.call("getDocument", {}), /takes path params/);
  await assert.rejects(a.call("updateDocumentComment", { documentID: "d", commentID: "c" }, { body: "x", author: "y" }), /author/);
});

test("api: every G8 row is callable through the fake with the contract's params", async () => {
  const { world, script } = createFakeWorld();
  const a = world.session("A");
  for (const [name, call] of Object.entries(G8_API_CALLS)) {
    script.queue(`api.${name}`, { status: 200, body: {} });
    const params = Object.fromEntries(Object.keys(call.params ?? {}).map((p) => [p, "x1"]));
    assert.equal((await a.call(name, params)).status, 200, name);
  }
});

test("web: webLogin -> {context, page, user, locale, setLocale, close}; openDocument follows the resource-href URL rule", async () => {
  const { world, web, browser, script } = createFakeWorld();
  const s = await web.webLogin(browser, world.user("B"), { locale: "vi" });
  assert.equal(s.locale, "vi");
  assert.ok(s.context && s.page);
  await s.setLocale("en");
  assert.equal(s.locale, "en");
  const opened = await web.openDocument(s.page, { org: "org-x", ws: "ws-w2", documentId: "doc-1", comment: "c-1", kind: "discussion" });
  assert.equal(new URL(opened.url).pathname, "/org-x/ws-w2/documents/doc-1");
  assert.equal(new URL(opened.url).search, "?comment=c-1&kind=discussion");
  assert.deepEqual([opened.status, opened.panelCount, opened.focusedCommentId], ["ok", 1, "c-1"]);
  script.queue("web.openDocument", { url: "x", status: "no-access", panelCount: 0, focusedCommentId: null });
  assert.equal((await web.openDocument(s.page, { org: "o", ws: "w", documentId: "d" })).status, "no-access");
  script.queue("web.openDocument", FAKE_TIMEOUT);
  await assert.rejects(web.openDocument(s.page, { org: "o", ws: "w", documentId: "d" }), /timed out/);
});

test("web: webSave (§13) defaults to a saved new version per call and is scriptable; webFrameEval is recorded", async () => {
  const { world, web, browser, script, calls } = createFakeWorld();
  const s = await web.webLogin(browser, world.user("A"));
  const first = await web.webSave(s.page, { kind: "docs" });
  const second = await web.webSave(s.page, { kind: "docs" });
  assert.equal(first.status, "saved");
  assert.ok(first.versionId && second.versionId && first.versionId !== second.versionId, "each default save is a new version");
  script.queue("web.webSave", { status: "timeout", reason: "no frame commit within the bound" });
  assert.equal((await web.webSave(s.page, { kind: "sheets" })).status, "timeout");
  await assert.rejects(web.webSave(s.page, { kind: "html" }), /kind must be one of/);
  assert.deepEqual(calls.web.filter((c) => c.key === "webSave").map((c) => c.args[1].kind), ["docs", "docs", "sheets"]);
  script.queue("web.webFrameEval", { status: "ok" });
  assert.deepEqual(await web.webFrameEval(s.page, "docs", () => 0, { type: "key" }), { status: "ok" });
  assert.equal(await web.webFrameEval(s.page, "docs", () => 0, null), undefined);
  assert.deepEqual(calls.web.filter((c) => c.key === "webFrameEval").map((c) => c.args[2]), [{ type: "key" }, null]);
});

test("app: ctrl has every §7 member; comments/discussion expose exactly the fork bridge names and return the envelope unchanged", async () => {
  const { app, script, calls, world } = createFakeWorld();
  const ctrl = await app.connectApp({ portsEnv: {}, runDir: "/tmp/x" });
  for (const m of ["signIn", "selectOrg", "signOut", "openByTicket", "editorPage", "comments", "discussion", "aiOffice", "save", "focus", "selection", "evalBounded", "close"]) {
    assert.equal(typeof ctrl[m], "function", m);
  }
  const page = await ctrl.editorPage("sheets");
  assert.equal(page.kind, "sheets");
  await assert.rejects(ctrl.editorPage("paint"), /no paint editor page/);
  // contract §15: the option that picks the page showing one document is recorded with the call
  await ctrl.editorPage("sheets", { path: "/wc/b.xlsx", documentId: "doc-b" });
  assert.deepEqual(calls.app.filter((c) => c.key === "editorPage").map((c) => c.args), [["sheets"], ["paint"], ["sheets", { path: "/wc/b.xlsx", documentId: "doc-b" }]]);
  const comments = ctrl.comments(page);
  assert.deepEqual(Object.keys(comments), [...COMMENTS_API_NAMES]);
  assert.deepEqual(Object.keys(ctrl.discussion()), [...DISCUSSION_API_NAMES]);
  assert.deepEqual(await comments.list({ path: "/p" }), { ok: false, error: { code: "fake_unscripted", message: "comments.list" } });
  const reply = { ok: true, value: { comment: { id: "c-1", anchor: { ...B7_ANCHOR } } } };
  script.queue("app.comments.create", reply);
  assert.deepEqual(await comments.create({ path: "/p", kind: "comment", body: "x", anchor: { ...B7_ANCHOR }, baseVersionId: "ver-1" }), reply);
  assert.deepEqual(calls.app.at(-1).args, [{ path: "/p", kind: "comment", body: "x", anchor: { ...B7_ANCHOR }, baseVersionId: "ver-1" }]);
  const signedIn = await ctrl.signIn(world.user("M"), { expectOrgChoice: true });
  assert.deepEqual(Object.keys(signedIn).sort(), ["expectOrgChoice", "orgApiCallsBeforeChoice", "orgChoiceShown", "sessionBinExists", "status"]);
  assert.deepEqual(await ctrl.openByTicket("uniwork-office-dev://open?ticket=T", { documentId: "doc-1" }), { path: "/fake/working-copy", documentId: "doc-1", kind: null });
  assert.deepEqual(await ctrl.focus("/fake/working-copy"), { activated: true, pages: 1 });
  await assert.rejects(ctrl.aiOffice("uniworkDeleteEverything"), /SHELL_API_NAMES/);
  script.queue("app.aiOffice.uniworkListWorkspaces", [{ id: "ws-W1", role: "owner" }]);
  assert.deepEqual(await ctrl.aiOffice("uniworkListWorkspaces"), [{ id: "ws-W1", role: "owner" }]);
});

test("app: FAKE_TIMEOUT rejects with the §7 isAppStepTimeout error carrying {call, elapsedMs}", async () => {
  const { app, script } = createFakeWorld();
  const ctrl = await app.connectApp({});
  script.queue("app.comments.list", FAKE_TIMEOUT);
  await assert.rejects(ctrl.comments(await ctrl.editorPage("docs")).list({ path: "/p" }), (err) => {
    assert.equal(err.isAppStepTimeout, true);
    assert.equal(err.appStepTimeout.call, "comments.list");
    assert.equal(typeof err.appStepTimeout.elapsedMs, "number");
    return true;
  });
});

test("script: queue answers are FIFO and win over respond; respond stands", async () => {
  const { app, script } = createFakeWorld();
  const ctrl = await app.connectApp({});
  script.respond("app.selection", { status: "ok", selection: "A1" });
  script.queue("app.selection", { status: "ok", selection: "B7" });
  script.queue("app.selection", { status: "ok", selection: "B8" });
  assert.equal((await ctrl.selection("sheets")).selection, "B7");
  assert.equal((await ctrl.selection("sheets")).selection, "B8");
  assert.equal((await ctrl.selection("sheets")).selection, "A1");
  assert.equal((await ctrl.selection("sheets")).selection, "A1");
  assert.equal(script.pending("app.selection"), 0);
});

test("run-row pure helpers: artifact path, exit mapping, step decision, args", () => {
  assert.equal(rowArtifactPath("/r", "G8-A07", "fx-xlsx-revenue-xyz"), "/r/reports/g7-qa/g8-a07/fx-xlsx-revenue-xyz.json");
  assert.throws(() => rowArtifactPath("/r", "A07", "fx"), /G8-A01/);
  assert.deepEqual([exitCodeFor("PASS"), exitCodeFor("FAIL"), exitCodeFor("BLOCKED"), exitCodeFor("??")], [0, 1, 77, 1]);
  assert.equal(ROW_EXIT.BLOCKED, 77);
  assert.equal(decideFromSteps({}).status, "FAIL");
  assert.equal(decideFromSteps({ a: { status: "PASS" } }).status, "PASS");
  const blocked = decideFromSteps({ a: { status: "PASS" }, b: { status: "BLOCKED", blocker: "R1", owner: "lead-f" } });
  assert.deepEqual([blocked.status, blocked.blocker, blocked.owner], ["BLOCKED", "R1", "lead-f"]);
  assert.equal(decideFromSteps({ a: { status: "FAIL", reason: "x" }, b: { status: "BLOCKED", blocker: "R1" } }).status, "FAIL");
  assert.deepEqual(parseRowArgs(["--row", "G8-A01", "--fixture", "fx-a", "--run-dir", "/r"], {}), {
    row: "G8-A01",
    fixture: "fx-a",
    runDir: "/r",
    timeoutMs: null,
  });
  assert.equal(parseRowArgs(["--row", "G8-A01", "--fixture", "fx-a"], { HARNESS_RUN_DIR: "/env" }).runDir, "/env");
  assert.throws(() => parseRowArgs(["--row", "G8-A01"], {}), /usage/);
  assert.deepEqual({ ...B7_ANCHOR }, { format: "xlsx", v: 1, sheet: "sheet-2", range: "B7" });
});

test("serverCommentCreateRefusal mirrors D's anchor rules (document_comment_anchors.go:254-276)", () => {
  const A = { format: "xlsx", v: 1, sheet: "sheet-2", range: "B7" };
  assert.equal(serverCommentCreateRefusal({ body: "x", kind: "comment" })?.status, 400);
  assert.equal(serverCommentCreateRefusal({ body: "x", kind: "comment" }).body.error.code, "invalid_request");
  assert.equal(serverCommentCreateRefusal({ body: "x", kind: "comment", anchor: A }).status, 400);
  assert.equal(serverCommentCreateRefusal({ body: "x", kind: "discussion", anchor: A, base_version_id: "v" }).status, 400);
  assert.equal(serverCommentCreateRefusal({ body: "x", parent_id: "p", anchor: A, base_version_id: "v" }).status, 400);
  assert.equal(serverCommentCreateRefusal({ body: "x", kind: "comment", anchor: A, base_version_id: "v" }), null);
  assert.equal(serverCommentCreateRefusal({ body: "x", kind: "discussion" }), null);
  assert.equal(serverCommentCreateRefusal({ body: "x" }), null);
  assert.equal(serverCommentCreateRefusal({ body: "x", parent_id: "p", kind: "comment" }), null);
});

test("bridgeCommentCreateRefusal mirrors the fork's parseCommentsCreateInput (comments-ipc.ts:260-276) -> malformed", () => {
  const A = { format: "docx", v: 1 };
  assert.equal(bridgeCommentCreateRefusal({ kind: "comment", body: "x" })?.error.code, "malformed");
  assert.equal(bridgeCommentCreateRefusal({ kind: "comment", body: "x", anchor: A })?.error.code, "malformed");
  assert.equal(bridgeCommentCreateRefusal({ kind: "discussion", body: "x", anchor: A, baseVersionId: "v" })?.error.code, "malformed");
  assert.equal(bridgeCommentCreateRefusal({ kind: "comment", body: "", anchor: A, baseVersionId: "v" })?.error.code, "malformed");
  assert.equal(bridgeCommentCreateRefusal({ kind: "comment", body: "x", anchor: A, baseVersionId: "v" }), null);
  assert.equal(bridgeCommentCreateRefusal({ kind: "discussion", body: "x" }), null);
  assert.equal(bridgeCommentCreateRefusal({ kind: "comment", body: "x", parentId: "p" }), null);
});
