// g8-19/inbox.mjs (UNI-1414): G8-A05 (a mention written on desktop reaches
// only the mentioned reader, one body format on both hosts) and G8-A06 (the
// web Inbox row in en and vi, read state per person), decided by
// decideG8A05 / decideG8A06.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

import { bridgeCommentCreateRefusal, createFakeWorld, serverCommentCreateRefusal } from "./fake-world.mjs";
import {
  decideG8A05,
  decideG8A06,
  expectedTitle,
  loadLocale,
  mentionBody,
  mentionToken,
  normalizeRowText,
  openOnDesktop,
  rowsForComment,
  runInbox,
  titleKeyFor,
} from "./inbox.mjs";
import { rowArtifactPath, runRowModule } from "./run-row.mjs";

const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

// ---- the body and the mention token ------------------------------------------------------------

test("mentionToken is the editor's token (server/internal/mentions/mentions.go:21-24)", () => {
  assert.equal(mentionToken("G8-19 B", "01J8X4K2M0N1P2Q3R4S5T6U7V8"), "[@G8-19 B](mention://member/01J8X4K2M0N1P2Q3R4S5T6U7V8)");
  assert.equal(mentionToken("a [b]", "01J8X4K2M0N1P2Q3R4S5T6U7V8"), "[@a \\[b\\]](mention://member/01J8X4K2M0N1P2Q3R4S5T6U7V8)");
});

test("mentionBody names B twice and A (the author) once, with Vietnamese text, and no outer whitespace", () => {
  const body = mentionBody({ A: { id: "A1", displayName: "An" }, B: { id: "B1", displayName: "Bình" } }, "r1");
  assert.equal(body.match(/mention:\/\/member\/B1/g).length, 2);
  assert.equal(body.match(/mention:\/\/member\/A1/g).length, 1);
  assert.equal(body, body.trim());
  assert.match(body, /r1/);
});

// ---- notification rows ---------------------------------------------------------------------------

const row = (extra = {}) => ({
  id: "n1",
  kind: "document_mentioned",
  resource_type: "document",
  resource_id: "doc-1",
  workspace_id: "ws-W1",
  title_key: "notifications.kind.document_mentioned",
  params: { comment_id: "c1", kind: "comment", actor: "G8-19 A", document: "Báo cáo", snippet: "Xem giúp" },
  count: 1,
  read_at: null,
  ...extra,
});

test("rowsForComment picks the document rows of one comment", () => {
  const rows = [row(), row({ id: "n2", params: { comment_id: "c2" } }), row({ id: "n3", resource_type: "task" })];
  assert.deepEqual(rowsForComment(rows, "doc-1", "c1").map((r) => r.id), ["n1"]);
  assert.deepEqual(rowsForComment(undefined, "doc-1", "c1"), []);
});

// ---- decideG8A05 ---------------------------------------------------------------------------------

const a05 = (extra = {}) => ({
  users: { A: "user-A", B: "user-B", C: "user-C" },
  documentId: "doc-1",
  commentId: "c1",
  sentBody: "Xem [@B](mention://member/user-B)",
  created: { ok: true, commentId: "c1" },
  candidates: {
    desktopB: { ok: true, ids: ["user-B"] },
    desktopC: { ok: true, ids: [] },
    rest: { status: 200, ids: ["user-A", "user-B"] },
  },
  notifications: { A: [], B: [row()], C: [] },
  bodies: { desktop: "Xem [@B](mention://member/user-B)", web: "Xem [@B](mention://member/user-B)" },
  ...extra,
});

test("decideG8A05: B gets exactly one document_mentioned row, A and C none, C never a candidate, bodies byte-equal -> PASS", () => {
  const out = decideG8A05(a05());
  assert.equal(out.status, "PASS", JSON.stringify(out.checks));
});

test("decideG8A05: two rows for B (the duplicate token notified twice) -> FAIL; a merged count > 1 -> FAIL", () => {
  assert.equal(decideG8A05(a05({ notifications: { A: [], B: [row(), row({ id: "n2" })], C: [] } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ notifications: { A: [], B: [row({ count: 2 })], C: [] } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ notifications: { A: [], B: [], C: [] } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ notifications: { A: [], B: [row({ kind: "document_commented" })], C: [] } })).status, "FAIL");
});

test("decideG8A05: a self-mention row for A, or any row for the non-reader C -> FAIL", () => {
  const self = decideG8A05(a05({ notifications: { A: [row({ id: "nA" })], B: [row()], C: [] } }));
  assert.equal(self.status, "FAIL");
  assert.match(self.checks.self.reason, /A/);
  assert.equal(decideG8A05(a05({ notifications: { A: [], B: [row()], C: [row({ id: "nC" })] } })).status, "FAIL");
});

test("decideG8A05: C offered by the desktop picker or the REST picker, or B missing from it -> FAIL", () => {
  assert.equal(decideG8A05(a05({ candidates: { ...a05().candidates, desktopC: { ok: true, ids: ["user-C"] } } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ candidates: { ...a05().candidates, rest: { status: 200, ids: ["user-B", "user-C"] } } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ candidates: { ...a05().candidates, desktopB: { ok: true, ids: [] } } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ candidates: { ...a05().candidates, desktopB: { ok: false, error: { code: "offline" } } } })).status, "FAIL");
});

test("decideG8A05: a body that differs between hosts (even by whitespace) -> FAIL; a failed desktop create -> FAIL", () => {
  assert.equal(decideG8A05(a05({ bodies: { desktop: "Xem [@B](mention://member/user-B)", web: "Xem  [@B](mention://member/user-B)" } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ bodies: { desktop: null, web: "Xem [@B](mention://member/user-B)" } })).status, "FAIL");
  assert.equal(decideG8A05(a05({ created: { ok: false, error: { code: "forbidden" } } })).status, "FAIL");
  assert.equal(decideG8A05({}).status, "FAIL");
});

// ---- titles (packages/core/i18n/locales/{en,vi}.json notifications.kind.*) -------------------------

test("titleKeyFor mirrors notification-title.tsx notificationTitleKey: no document name -> _untitled", () => {
  assert.equal(titleKeyFor(row()), "notifications.kind.document_mentioned");
  assert.equal(titleKeyFor(row({ params: { comment_id: "c1" } })), "notifications.kind.document_mentioned_untitled");
});

test("expectedTitle renders the real en and vi templates with the row params", () => {
  const en = loadLocale(REPO, "en");
  const vi = loadLocale(REPO, "vi");
  assert.equal(expectedTitle(en, row()), "G8-19 A mentioned you in a comment on “Báo cáo”.");
  assert.equal(expectedTitle(vi, row()), "G8-19 A đã nhắc đến bạn trong bình luận tại tài liệu “Báo cáo”.");
  assert.equal(expectedTitle(en, row({ kind: "nope", title_key: "notifications.kind.nope" })), null);
});

test("normalizeRowText drops the param markers and collapses whitespace", () => {
  assert.equal(normalizeRowText("Unread:\n  G8-19 A⁣ mentioned  you"), "Unread: G8-19 A mentioned you");
});

// ---- decideG8A06 ---------------------------------------------------------------------------------

const a06 = (extra = {}) => ({
  notification: row(),
  plainRows: [],
  selfRows: [],
  titles: {
    en: { rowText: "Unread: G8-19 A mentioned you in a comment on “Báo cáo”. Xem giúp", expected: "G8-19 A mentioned you in a comment on “Báo cáo”." },
    vi: { rowText: "Chưa đọc: G8-19 A đã nhắc đến bạn trong bình luận tại tài liệu “Báo cáo”.", expected: "G8-19 A đã nhắc đến bạn trong bình luận tại tài liệu “Báo cáo”." },
  },
  read: { markStatus: 200, foreignStatus: 404, rowReadAt: "2026-10-15T05:00:00Z", bBefore: 2, bAfter: 1, aBefore: 3, aAfter: 3 },
  ...extra,
});

test("decideG8A06: en + vi title on the row, mark read only for B, A untouched -> PASS", () => {
  const out = decideG8A06(a06());
  assert.equal(out.status, "PASS", JSON.stringify(out.checks));
});

test("decideG8A06: a missing en or vi title, or the same text in both locales -> FAIL", () => {
  assert.equal(decideG8A06(a06({ titles: { ...a06().titles, vi: { rowText: "G8-19 A mentioned you", expected: a06().titles.vi.expected } } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ titles: { en: { rowText: "", expected: a06().titles.en.expected }, vi: a06().titles.vi } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ titles: { en: a06().titles.en, vi: { rowText: a06().titles.en.rowText, expected: a06().titles.en.expected } } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ titles: { en: { rowText: "x", expected: null }, vi: a06().titles.vi } })).status, "FAIL");
});

test("decideG8A06: read state is per person: A's count moved, B's did not, or A could mark B's row -> FAIL", () => {
  assert.equal(decideG8A06(a06({ read: { ...a06().read, aAfter: 2 } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ read: { ...a06().read, bAfter: 2 } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ read: { ...a06().read, rowReadAt: null } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ read: { ...a06().read, foreignStatus: 200 } })).status, "FAIL");
  assert.equal(decideG8A06(a06({ read: { ...a06().read, markStatus: 500 } })).status, "FAIL");
});

test("decideG8A06: a plain comment notified B, or the author notified themself -> FAIL", () => {
  assert.equal(decideG8A06(a06({ plainRows: [row({ id: "np" })] })).status, "FAIL");
  assert.equal(decideG8A06(a06({ selfRows: [row({ id: "ns" })] })).status, "FAIL");
  assert.equal(decideG8A06({}).status, "FAIL");
});

// ---- the module flow against the fake world ------------------------------------------------------

let runDir;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-inbox-"));
  writeFileSync(join(runDir, "ports.env"), "API_ORIGIN=http://127.0.0.1:9\nWEB_ORIGIN=http://127.0.0.1:8\nOFFICE_FORK_SHA=7d665a54\n");
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "up" }));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

/** A fake server: a mention notifies its readers once (never the author), a mark-read flips one row. */
function scripted({ duplicateRows = false, cCandidate = false } = {}) {
  const fake = createFakeWorld();
  const { world, script } = fake;
  const comments = new Map();
  const readIds = new Set();
  let seq = 0;
  const readers = (documentId) => {
    const doc = world.docs[documentId];
    const shared = Object.values(world.shares).filter((s) => s.documentId === documentId && !s.revoked).map((s) => s.userId);
    const wsMembers = doc.workspaceKey === "W2" ? ["user-B", "user-C"] : [];
    return new Set(["user-A", ...shared, ...wsMembers]);
  };
  const create = (documentId, body, author) => {
    seq += 1;
    const id = `c${seq}`;
    comments.set(id, { documentId, body, author });
    return id;
  };
  script.respond("api.createDocumentComment", (call) =>
    serverCommentCreateRefusal(call.args.body) ?? { status: 201, body: { comment: { id: create(call.args.pathParams.documentID, call.args.body.body, call.user), body: call.args.body.body } } });
  script.respond("app.comments.create", (call) => {
    const [input] = call.args;
    const refused = bridgeCommentCreateRefusal(input);
    if (refused) return refused;
    const id = create("doc-1", input.body, "A");
    return { ok: true, value: { comment: { id, body: input.body } } };
  });
  script.respond("app.comments.list", () => ({ ok: true, value: { comments: [...comments.entries()].map(([id, c]) => ({ id, body: c.body })) } }));
  script.respond("api.listDocumentComments", () => ({ status: 200, body: { comments: [...comments.entries()].map(([id, c]) => ({ id, body: c.body })) } }));
  // the picker lists readers only; cCandidate breaks that rule
  const candidateIds = (q) =>
    [...readers("doc-1"), ...(cCandidate ? ["user-C"] : [])].filter((id) => !q || world.user(id.slice(5)).displayName.includes(q));
  script.respond("app.comments.searchMentions", (call) => ({ ok: true, value: { candidates: candidateIds(call.args[0].q).map((user_id) => ({ user_id })) } }));
  script.respond("api.listMentionCandidates", (call) => ({ status: 200, body: { candidates: candidateIds(call.args.query?.q).map((user_id) => ({ user_id })) } }));
  script.respond("api.mintLaunch", { status: 201, body: { launch_ticket: "ticket_x", launch_url: "uniwork-office-dev://open?ticket=ticket_x" } });
  script.respond("app.openByTicket", (call) => ({ path: "/fake/wc", documentId: call.args[1]?.documentId ?? null, kind: "docs" }));
  const rowsOf = (userKey) => {
    const uid = `user-${userKey}`;
    const out = [];
    for (const [id, c] of comments) {
      if (!new RegExp(`mention://member/${uid}\\b`).test(c.body) || c.author === userKey || !readers(c.documentId).has(uid)) continue;
      const n = {
        id: `n-${userKey}-${id}`,
        kind: "document_mentioned",
        resource_type: "document",
        resource_id: c.documentId,
        workspace_id: world.workspace("X", world.docs[c.documentId].workspaceKey).id,
        title_key: "notifications.kind.document_mentioned",
        params: { comment_id: id, kind: "comment", actor: "G8 A", document: "Báo cáo" },
        count: 1,
        read_at: readIds.has(`n-${userKey}-${id}`) ? "2026-10-15T05:00:00Z" : null,
      };
      out.push(n);
      if (duplicateRows) out.push({ ...n, id: `${n.id}-dup` });
    }
    return out;
  };
  script.respond("api.listNotifications", (call) => ({ status: 200, body: { notifications: rowsOf(call.user) } }));
  script.respond("api.unreadNotificationCount", (call) => ({ status: 200, body: { total: rowsOf(call.user).filter((n) => !n.read_at).length + 1 } }));
  script.respond("api.markNotificationsRead", (call) => {
    const ids = call.args.body.ids;
    if (!ids.every((id) => id.startsWith(`n-${call.user}-`))) return { status: 404, body: { error: "not_found" } };
    for (const id of ids) readIds.add(id);
    return { status: 200, body: { status: "ok", ids: [] } };
  });
  const en = loadLocale(REPO, "en");
  const vi = loadLocale(REPO, "vi");
  const readInbox = async (page, { notificationId }) => {
    const n = rowsOf("B").find((r) => r.id === notificationId);
    if (!n) return { listed: false, href: null, text: "" };
    const locale = fake.calls.web.filter((c) => c.key === "setLocale").at(-1)?.args[1] ?? "en";
    return { listed: true, href: `/org-x/ws-w2/documents/${n.resource_id}?comment=${n.params.comment_id}`, text: `• ${expectedTitle(locale === "vi" ? vi : en, n)} Xem` };
  };
  return { fake, deps: { web: fake.web, connectApp: fake.app.connectApp, launchBrowser: async () => fake.browser, readInbox, sleep: async () => {}, pollMs: 0, pollTimeoutMs: 50, repoRoot: REPO } };
}

const runRow = (row, deps, world) =>
  runRowModule({ row, fixture: "fx-docx-report-vi", runDir, module: "inbox", timeoutMs: 10_000, worldFactory: () => world }, (ctx) => runInbox(ctx, deps));
const artifact = (row) => JSON.parse(readFileSync(rowArtifactPath(runDir, row, "fx-docx-report-vi"), "utf8"));

test("runInbox G8-A05: desktop picker, desktop create as A, one row for B -> PASS; the document is in W1 shared to B only", async () => {
  const { fake, deps } = scripted();
  const exit = await runRow("G8-A05", deps, fake.world);
  const a = artifact("G8-A05");
  assert.equal(exit, 0, JSON.stringify(a, null, 1));
  assert.deepEqual(fake.calls.world.find((c) => c.key === "upload").args.slice(0, 2), ["A", "W1"]);
  assert.ok(fake.calls.world.some((c) => c.key === "share" && c.args[2] === "user-B"));
  assert.ok(!fake.calls.world.some((c) => c.key === "share" && c.args[2] === "user-C"));
  // the mention body was written through the desktop bridge, not REST
  assert.equal(fake.calls.app.filter((c) => c.key === "comments.create").length, 1);
  assert.equal(fake.calls.api.filter((c) => c.key === "createDocumentComment").length, 0);
  assert.ok(!/fake-password|fake-token/.test(JSON.stringify(a)));
});

test("runInbox G8-A05: a duplicate notification or C in the picker -> FAIL", async () => {
  const dup = scripted({ duplicateRows: true });
  assert.equal(await runRow("G8-A05", dup.deps, dup.fake.world), 1);
  const c = scripted({ cCandidate: true });
  assert.equal(await runRow("G8-A05", c.deps, c.fake.world), 1);
  assert.equal(artifact("G8-A05").status, "FAIL");
});

test("runInbox G8-A06: en + vi titles on B's W2 Inbox row, B marks it read, A cannot -> PASS", async () => {
  const { fake, deps } = scripted();
  const exit = await runRow("G8-A06", deps, fake.world);
  const a = artifact("G8-A06");
  assert.equal(exit, 0, JSON.stringify(a, null, 1));
  assert.deepEqual(fake.calls.world.find((c) => c.key === "upload").args.slice(0, 2), ["A", "W2"]);
  assert.ok(fake.calls.web.some((c) => c.key === "setLocale" && c.args[1] === "vi"));
  const marks = fake.calls.api.filter((c) => c.key === "markNotificationsRead");
  assert.deepEqual(marks.map((m) => m.user).sort(), ["A", "B"]);
});

test("runInbox: a row other than A05/A06 is refused (FAIL)", async () => {
  const { fake, deps } = scripted();
  const exit = await runRowModule({ row: "G8-A09", fixture: "fx-docx-report-vi", runDir, module: "inbox", timeoutMs: 5_000, worldFactory: () => fake.world }, (ctx) => runInbox(ctx, deps));
  assert.equal(exit, 1);
});

test("runInbox G8-A05: the desktop create is a root kind=comment with the fixture's anchor and the uploaded version (comments-ipc.ts:260-276)", async () => {
  const { fake, deps } = scripted();
  assert.equal(await runRow("G8-A05", deps, fake.world), 0, JSON.stringify(artifact("G8-A05"), null, 1));
  const [input] = fake.calls.app.find((c) => c.key === "comments.create").args;
  assert.equal(input.kind, "comment");
  assert.equal(input.anchor?.format, "docx");
  assert.equal(input.baseVersionId, fake.calls.world.find((c) => c.key === "upload").result?.versionId ?? "ver-1");
});

test("runInbox G8-A06: the REST comments carry anchor + base_version_id; a server refusal names its code and message, never [object Object]", async () => {
  const { fake, deps } = scripted();
  assert.equal(await runRow("G8-A06", deps, fake.world), 0, JSON.stringify(artifact("G8-A06"), null, 1));
  for (const c of fake.calls.api.filter((x) => x.key === "createDocumentComment")) {
    assert.equal(c.args.body.kind, "comment");
    assert.equal(c.args.body.anchor?.format, "docx");
    assert.ok(c.args.body.base_version_id);
  }
  const refusing = scripted();
  refusing.fake.script.respond("api.createDocumentComment", { status: 400, body: { error: { code: "anchor_version_invalid", message: "phiên bản neo không hợp lệ" } } });
  assert.equal(await runRow("G8-A06", refusing.deps, refusing.fake.world), 1);
  const reason = artifact("G8-A06").reason;
  assert.match(reason, /400 anchor_version_invalid: phiên bản neo không hợp lệ/);
  assert.doesNotMatch(reason, /object Object/);
});

test("openOnDesktop asks the app for the editor page that shows the opened path (harness contract §15), never the first page of the kind", async () => {
  const fake = createFakeWorld();
  fake.script.respond("api.mintLaunch", { status: 201, body: { launch_url: "uniwork-office-dev://open?ticket=t1" } });
  fake.script.respond("app.openByTicket", (call) => ({ path: "/wc/second.docx", documentId: call.args[1]?.documentId, kind: "docs" }));
  const ctrl = await fake.app.connectApp({});
  const opened = await openOnDesktop(ctrl, fake.world, "A", "doc-2", "docx");
  assert.equal(opened.path, "/wc/second.docx");
  assert.deepEqual(fake.calls.app.filter((c) => c.key === "editorPage").map((c) => c.args), [["docs", { path: "/wc/second.docx", documentId: "doc-2" }]]);
});
