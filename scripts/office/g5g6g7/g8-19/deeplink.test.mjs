// g8-19/deeplink.mjs (UNI-1414, G8-A07): the web href rule, the frame-pin
// gate R1, the desktop reveal through a launch ticket, the five UNI-1389
// exceptions and the cross-workspace share, decided by decideG8A07.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  DEEP_LINK_EXCEPTIONS,
  decideDesktopReveal,
  decideException,
  decideG8A07,
  expectedDocumentHref,
  formatOfFixture,
  framePinVerdict,
  hrefCommentId,
  launchCommentId,
  normalizeSelection,
  readFramePin,
  runDeeplink,
} from "./deeplink.mjs";
import { createFakeWorld, serverCommentCreateRefusal } from "./fake-world.mjs";
import { B7_SHEET_NAME, WEB_FRAME_PIN_BLOCKER, WEB_FRAME_PIN_OWNER, rowArtifactPath, runRowModule } from "./run-row.mjs";

const W1 = { id: "ws-W1", slug: "ws-w1", organization_slug: "org-x" };
const W2 = { id: "ws-W2", slug: "ws-w2", organization_slug: "org-x" };
const docNotif = (extra = {}) => ({
  id: "n1",
  kind: "document_mentioned",
  workspace_id: "ws-W1",
  resource_type: "document",
  resource_id: "doc-1",
  params: { comment_id: "c1", kind: "comment" },
  ...extra,
});

// ---- expectedDocumentHref mirrors packages/views/notifications/resource-href.ts:10-44 ----------

test("expectedDocumentHref: the notification's own workspace when the recipient is a member", () => {
  assert.equal(expectedDocumentHref(docNotif(), W2, [W1, W2]), "/org-x/ws-w1/documents/doc-1?comment=c1");
});

test("expectedDocumentHref: a document shared from a workspace the recipient is not in opens in the open workspace", () => {
  assert.equal(expectedDocumentHref(docNotif(), W2, [W2]), "/org-x/ws-w2/documents/doc-1?comment=c1");
});

test("expectedDocumentHref: a discussion adds kind=discussion; no comment id means the bare document", () => {
  assert.equal(
    expectedDocumentHref(docNotif({ params: { comment_id: "c9", kind: "discussion" } }), W1, [W1]),
    "/org-x/ws-w1/documents/doc-1?comment=c9&kind=discussion",
  );
  assert.equal(expectedDocumentHref(docNotif({ params: {} }), W1, [W1]), "/org-x/ws-w1/documents/doc-1");
  assert.equal(expectedDocumentHref(docNotif({ params: { kind: "discussion" } }), W1, [W1]), "/org-x/ws-w1/documents/doc-1");
});

test("hrefCommentId + launchCommentId: the page's ?comment= rides the ticket only when id-shaped (desktop-handoff.ts:27-36)", () => {
  assert.equal(hrefCommentId("/org-x/ws-w2/documents/doc-1?comment=01J8ABC&kind=discussion"), "01J8ABC");
  assert.equal(hrefCommentId("http://127.0.0.1:2/org-x/ws-w2/documents/doc-1"), null);
  assert.equal(launchCommentId("01J8X4CMTN1P2Q3R4S5T6U7V"), "01J8X4CMTN1P2Q3R4S5T6U7V");
  assert.equal(launchCommentId("bad id"), undefined);
  assert.equal(launchCommentId("x".repeat(129)), undefined);
  assert.equal(launchCommentId(""), undefined);
});

// ---- the frame pin gate (R1) ---------------------------------------------------------------------

let repo;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "g819-pin-"));
  mkdirSync(join(repo, "apps/web/platform/office-frame"), { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));
const writePin = (file, gitSha) =>
  writeFileSync(join(repo, "apps/web/platform/office-frame", file), JSON.stringify({ schema: 1, version: `0.1.0-${gitSha}`, gitSha }));

test("formatOfFixture reads the format out of the fixture id", () => {
  assert.equal(formatOfFixture("fx-xlsx-revenue-xyz"), "xlsx");
  assert.equal(formatOfFixture("fx-docx-report-vi"), "docx");
  assert.equal(formatOfFixture("nonsense"), null);
});

test("readFramePin: docx -> docs.pin.json, xlsx -> sheets.pin.json; a format with no pin file is unframed", () => {
  writePin("docs.pin.json", "05fd209");
  writePin("sheets.pin.json", "abc1234");
  assert.deepEqual(readFramePin(repo, "docx"), { file: "apps/web/platform/office-frame/docs.pin.json", gitSha: "05fd209" });
  assert.deepEqual(readFramePin(repo, "xlsx"), { file: "apps/web/platform/office-frame/sheets.pin.json", gitSha: "abc1234" });
  assert.equal(readFramePin(repo, "pptx"), null);
  assert.equal(readFramePin(repo, "md"), null);
});

test("framePinVerdict: 05fd209 is old (BLOCKED R1, owner lead-f); a re-pin flips it without a code change", () => {
  const old = framePinVerdict({ file: "x/sheets.pin.json", gitSha: "05fd209" });
  assert.equal(old.framed, true);
  assert.equal(old.old, true);
  assert.equal(old.blocker, WEB_FRAME_PIN_BLOCKER);
  assert.equal(old.owner, WEB_FRAME_PIN_OWNER);
  const repinned = framePinVerdict({ file: "x/sheets.pin.json", gitSha: "7d665a5" });
  assert.equal(repinned.old, false);
  assert.equal(repinned.blocker, "");
  assert.deepEqual(framePinVerdict(null), { framed: false, old: false, gitSha: null, file: null, blocker: "", owner: "" });
  // an ancestry answer, when one is available, decides an unknown sha
  const checked = framePinVerdict({ file: "f", gitSha: "1111111" }, { containsG812To15: () => false });
  assert.equal(checked.old, true);
  assert.match(checked.blocker, /1111111 lacks G8-12\.\.15/);
});

// ---- desktop reveal + selection ------------------------------------------------------------------

test("normalizeSelection: 'Doanh thu Q2!B7' from the sheets control reply (fork apps/sheets/src/renderer/control.ts:34-50)", () => {
  assert.equal(normalizeSelection({ status: "ok", result: { sheet: B7_SHEET_NAME, range: "B7" } }), "Doanh thu Q2!B7");
  assert.equal(normalizeSelection({ status: "ok", result: { sheet: B7_SHEET_NAME, range: "$B$7:$B$7" } }), "Doanh thu Q2!B7");
  assert.equal(normalizeSelection({ status: "not_ready" }), null);
  assert.equal(normalizeSelection(null), null);
});

const desktopOk = (extra = {}) => ({
  commentId: "c1",
  documentId: "doc-1",
  format: "xlsx",
  ticketCommentId: "c1",
  openedDocumentId: "doc-1",
  thread: { present: true, focusedThreadId: "c1", anchorState: "exact" },
  selection: { status: "ok", result: { sheet: B7_SHEET_NAME, range: "B7" } },
  ...extra,
});

test("decideDesktopReveal: xlsx PASS needs the ticket comment, the opened document, the focused thread and Doanh thu Q2!B7", () => {
  assert.equal(decideDesktopReveal(desktopOk()).status, "PASS");
  const wrongCell = decideDesktopReveal(desktopOk({ selection: { status: "ok", result: { sheet: B7_SHEET_NAME, range: "A1" } } }));
  assert.equal(wrongCell.status, "FAIL");
  assert.match(wrongCell.reason, /Doanh thu Q2!A1/);
  assert.equal(decideDesktopReveal(desktopOk({ ticketCommentId: null })).status, "FAIL");
  assert.equal(decideDesktopReveal(desktopOk({ openedDocumentId: "doc-2" })).status, "FAIL");
  assert.equal(decideDesktopReveal(desktopOk({ thread: { present: true, focusedThreadId: null } })).status, "FAIL");
  // docx: no cell to check, the thread alone
  assert.equal(decideDesktopReveal(desktopOk({ format: "docx", selection: null })).status, "PASS");
});

// ---- the five exceptions (UNI-1389) --------------------------------------------------------------

const noAccessOk = () => ({
  stranger: { web: { status: "not-found" } },
  revoked: { web: { status: "no-access" }, notification: { resource_access_lost: true } },
});

test("DEEP_LINK_EXCEPTIONS lists the five UNI-1389 cases", () => {
  assert.deepEqual(Object.keys(DEEP_LINK_EXCEPTIONS).sort(), ["anchor_lost", "comment_deleted", "deleted", "no_access", "session_expired"]);
});

test("decideException maps each observed state", () => {
  const pin = framePinVerdict(null);
  assert.equal(decideException("no_access", noAccessOk(), { pin }).status, "PASS");
  assert.equal(decideException("no_access", { ...noAccessOk(), revoked: { ...noAccessOk().revoked, web: { status: "ok" } } }, { pin }).status, "FAIL");

  const gone = { web: { status: "not-found" }, notification: { resource_deleted: true, params: { comment_id: "c1" } } };
  assert.equal(decideException("deleted", gone, { pin }).status, "PASS");
  assert.equal(decideException("deleted", { ...gone, notification: { resource_deleted: true, params: { snippet: "x" } } }, { pin }).status, "FAIL");
  assert.equal(decideException("deleted", { ...gone, web: { status: "no-access" } }, { pin }).status, "FAIL");

  const cd = { notification: { comment_deleted: true }, desktop: { openedDocumentId: "doc-1", documentId: "doc-1", focusedThreadId: null }, web: { status: "error", panelCount: 1, focusedCommentId: null } };
  assert.equal(decideException("comment_deleted", cd, { pin }).status, "PASS");
  assert.equal(decideException("comment_deleted", { ...cd, notification: { comment_deleted: false } }, { pin }).status, "FAIL");
  assert.equal(decideException("comment_deleted", { ...cd, desktop: { ...cd.desktop, focusedThreadId: "c2" } }, { pin }).status, "FAIL");

  const lost = { commentId: "c3", listedBeforeLaunch: true, desktop: { focusedThreadId: "c3", anchorState: "lost" } };
  assert.equal(decideException("anchor_lost", lost, { pin }).status, "PASS");
  assert.equal(decideException("anchor_lost", { ...lost, desktop: { focusedThreadId: "c3", anchorState: "exact" } }, { pin }).status, "FAIL");
  assert.equal(decideException("anchor_lost", { notApplicable: "docx has no B7 anchor" }, { pin }).status, "N/A");

  assert.equal(decideException("session_expired", { web: { url: "http://127.0.0.1:2/login?next=%2Forg-x" } }, { pin }).status, "PASS");
  assert.equal(decideException("session_expired", { web: { url: "http://127.0.0.1:2/org-x/ws-w2/documents/doc-1" } }, { pin }).status, "FAIL");
  assert.equal(decideException("session_expired", undefined, { pin }).status, "FAIL");
});

test("decideException no_access: C (never shared) gets the gone page, B (revoked, row reads resource_access_lost) gets S15 no-access", () => {
  const pin = framePinVerdict(null);
  // C never had access and has no row: the server's 404 (Backend ID Rules) is the S15 gone page, never no-access
  const leak = decideException("no_access", { ...noAccessOk(), stranger: { web: { status: "no-access" } } }, { pin });
  assert.equal(leak.status, "FAIL");
  assert.match(leak.reason, /C, who was never given the document/);
  assert.equal(decideException("no_access", { ...noAccessOk(), stranger: null }, { pin }).status, "FAIL");
  // B after the revoke: the gone page while the row reads resource_access_lost is the product finding of revoke.mjs
  const gone = decideException("no_access", { ...noAccessOk(), revoked: { web: { status: "not-found" }, notification: { resource_access_lost: true } } }, { pin });
  assert.equal(gone.status, "FAIL");
  assert.match(gone.reason, /^product: /);
  assert.match(gone.reason, /owner candidate Lead D/);
  const notRun = decideException("no_access", { ...noAccessOk(), revoked: null }, { pin });
  assert.equal(notRun.status, "FAIL");
  assert.match(notRun.reason, /revoked recipient was not observed/);
});

test("decideException comment_deleted: a refused launch ticket is a product FAIL citing the contract's silent drop; the row flag is judged first", () => {
  const pin = framePinVerdict(null);
  const refused = { notification: { comment_deleted: true }, launch: { refused: true, status: 404, error: "not_found: not found" }, desktop: null, web: null };
  const out = decideException("comment_deleted", refused, { pin });
  assert.equal(out.status, "FAIL");
  assert.match(out.reason, /^product: /);
  assert.match(out.reason, /404 not_found/);
  assert.match(out.reason, /contract-collab\.md §2\.9/);
  assert.match(out.reason, /OQ-C6/);
  assert.match(out.reason, /S15 row 3/);
  assert.match(out.reason, /office_launch\.go:168-188/);
  assert.match(out.reason, /owner candidate Lead D/);
  const noFlag = decideException("comment_deleted", { ...refused, notification: { comment_deleted: false } }, { pin });
  assert.equal(noFlag.reason, "the row does not read comment_deleted");
});

test("decideException anchor_lost: a thread the open panel never listed before the re-launch is not judged as a reveal miss", () => {
  const pin = framePinVerdict(null);
  const unlisted = decideException("anchor_lost", { commentId: "c3", listedBeforeLaunch: false, desktop: { focusedThreadId: null, anchorState: null } }, { pin });
  assert.equal(unlisted.status, "FAIL");
  assert.match(unlisted.reason, /did not list c3/);
  const missed = decideException("anchor_lost", { commentId: "c3", listedBeforeLaunch: true, desktop: { focusedThreadId: null, anchorState: "lost" } }, { pin });
  assert.match(missed.reason, /focus none/);
  assert.match(missed.reason, /listed it before the launch/);
});

test("decideException: the web half of comment_deleted inside an old frame is BLOCKED(R1), never PASS", () => {
  const pin = framePinVerdict({ file: "f", gitSha: "05fd209" });
  const cd = { notification: { comment_deleted: true }, desktop: { openedDocumentId: "doc-1", documentId: "doc-1", focusedThreadId: null }, web: null };
  const out = decideException("comment_deleted", cd, { pin });
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.blocker, WEB_FRAME_PIN_BLOCKER);
  // a harness/app failure under the old pin is still FAIL
  assert.equal(decideException("comment_deleted", { ...cd, notification: { comment_deleted: false } }, { pin }).status, "FAIL");
});

// ---- decideG8A07 -----------------------------------------------------------------------------------

const exceptionsOk = () => ({
  no_access: noAccessOk(),
  deleted: { web: { status: "not-found" }, notification: { resource_deleted: true, params: {} } },
  comment_deleted: { notification: { comment_deleted: true }, desktop: { openedDocumentId: "doc-1", documentId: "doc-1", focusedThreadId: null }, web: { status: "error", panelCount: 1, focusedCommentId: null } },
  anchor_lost: { commentId: "c3", listedBeforeLaunch: true, desktop: { focusedThreadId: "c3", anchorState: "lost" } },
  session_expired: { web: { url: "http://127.0.0.1:2/login" } },
});
const a07 = (extra = {}) => ({
  commentId: "c1",
  documentId: "doc-1",
  format: "xlsx",
  framePin: framePinVerdict({ file: "f", gitSha: "7d665a5" }),
  href: { observed: "/org-x/ws-w2/documents/doc-1?comment=c1", expected: "/org-x/ws-w2/documents/doc-1?comment=c1" },
  webOpen: { status: "ok", panelCount: 1, focusedCommentId: "c1" },
  desktop: desktopOk(),
  crossWorkspace: {
    inboxListed: true,
    href: "/org-x/ws-w2/documents/doc-9?comment=c9",
    expectedHref: "/org-x/ws-w2/documents/doc-9?comment=c9",
    opened: { status: "ok", panelCount: 1, focusedCommentId: "c9" },
  },
  exceptions: exceptionsOk(),
  ...extra,
});

test("decideG8A07: everything observed on a re-pinned frame -> PASS", () => {
  const out = decideG8A07(a07());
  assert.equal(out.status, "PASS", JSON.stringify(out.checks));
  assert.deepEqual(Object.keys(out.checks).sort(), ["cross-workspace", "desktop-reveal", "exceptions", "web-href", "web-open"]);
});

test("decideG8A07: the web panel inside the old frame is BLOCKED(R1) and the row is BLOCKED, never PASS, even if the page looked fine", () => {
  const out = decideG8A07(a07({ framePin: framePinVerdict({ file: "f", gitSha: "05fd209" }), crossWorkspace: { ...a07().crossWorkspace, opened: { status: "error", reason: "the Office frame is shown without a D comment panel" } }, exceptions: { ...exceptionsOk(), comment_deleted: { ...exceptionsOk().comment_deleted, web: null } } }));
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.blocker, WEB_FRAME_PIN_BLOCKER);
  assert.equal(out.owner, WEB_FRAME_PIN_OWNER);
  assert.equal(out.checks["web-open"].status, "BLOCKED");
  assert.equal(out.checks["desktop-reveal"].status, "PASS");
  assert.equal(out.checks["web-href"].status, "PASS");
});

test("decideG8A07: a wrong href, a desktop miss or a failed exception is FAIL even under the old pin", () => {
  const old = framePinVerdict({ file: "f", gitSha: "05fd209" });
  assert.equal(decideG8A07(a07({ framePin: old, href: { observed: "/org-x/ws-w1/documents/doc-1?comment=c1", expected: "/org-x/ws-w2/documents/doc-1?comment=c1" } })).status, "FAIL");
  assert.equal(decideG8A07(a07({ framePin: old, desktop: desktopOk({ thread: { present: false, focusedThreadId: null } }) })).status, "FAIL");
  assert.equal(decideG8A07(a07({ framePin: old, exceptions: { ...exceptionsOk(), no_access: { web: { status: "ok" } } } })).status, "FAIL");
  assert.equal(decideG8A07(a07({ href: { observed: null, expected: "/x" } })).status, "FAIL");
});

test("decideG8A07: the cross-workspace notification must be listed in the recipient's Inbox and open in the recipient's workspace", () => {
  const notListed = decideG8A07(a07({ crossWorkspace: { ...a07().crossWorkspace, inboxListed: false, href: null } }));
  assert.equal(notListed.status, "FAIL");
  assert.match(notListed.checks["cross-workspace"].reason, /not listed/);
  const wrongWs = decideG8A07(a07({ crossWorkspace: { ...a07().crossWorkspace, href: "/org-x/ws-w1/documents/doc-9?comment=c9" } }));
  assert.equal(wrongWs.status, "FAIL");
  const s15 = decideG8A07(a07({ crossWorkspace: { ...a07().crossWorkspace, opened: { status: "no-access" } } }));
  assert.equal(s15.status, "FAIL");
});

test("decideG8A07: an empty record is FAIL", () => {
  assert.equal(decideG8A07({}).status, "FAIL");
  assert.equal(decideG8A07(null).status, "FAIL");
});

// ---- the module flow against the fake world --------------------------------------------------------

let runDir;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-dl-"));
  writeFileSync(join(runDir, "ports.env"), "API_ORIGIN=http://127.0.0.1:9\nWEB_ORIGIN=http://127.0.0.1:8\nOFFICE_FORK_SHA=7d665a54\n");
  writeFileSync(join(runDir, "start-status.json"), JSON.stringify({ state: "up" }));
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

/** Scripts a fake server where every mention reaches B and every revoke/archive flips the row flags. */
function scriptedWorld({ hrefWorkspace = "ws-w2", launchRefusesGoneComment = false, revokedShowsGone = false } = {}) {
  const fake = createFakeWorld();
  const { world, script } = fake;
  let commentSeq = 0;
  const comments = new Map(); // id -> {documentId, body, deleted}
  const archived = new Set();
  script.respond("api.createDocumentComment", (call) => {
    const refused = serverCommentCreateRefusal(call.args.body);
    if (refused) return refused;
    commentSeq += 1;
    const id = `c${commentSeq}`;
    comments.set(id, { documentId: call.args.pathParams.documentID, body: call.args.body.body, deleted: false });
    return { status: 201, body: { comment: { id, body: call.args.body.body } } };
  });
  script.respond("api.deleteDocumentComment", (call) => {
    comments.get(call.args.pathParams.commentID).deleted = true;
    return { status: 204 };
  });
  script.respond("api.putDocumentCommentAnchors", { status: 200, body: { anchors: [] } });
  script.respond("api.archiveDocument", (call) => {
    archived.add(call.args.pathParams.documentID);
    return { status: 200, body: {} };
  });
  script.respond("api.mintLaunch", (call) => {
    const cid = call.args.body.comment_id;
    // D office_launch.go:168-188 refuses a comment that is gone; the contract (§2.9, OQ-C6) drops it silently
    if (launchRefusesGoneComment && cid && comments.get(cid)?.deleted) return { status: 404, body: { error: { code: "not_found", message: "not found" } } };
    return { status: 201, body: { launch_ticket: "ticket_x", launch_url: `uniwork-office-dev://open?ticket=ticket_${cid ?? "none"}` } };
  });
  script.respond("api.listDocumentComments", (call) =>
    call.user === "B" && Object.values(world.shares).some((s) => s.documentId === call.args.pathParams.documentID && s.revoked)
      ? { status: 404, body: { error: "not_found" } }
      : { status: 200, body: { comments: [] } },
  );
  script.respond("api.listNotifications", (call) => {
    if (call.user !== "B") return { status: 200, body: { notifications: [] } };
    const rows = [...comments.entries()]
      .filter(([, c]) => /mention:\/\/member\/user-B/.test(c.body))
      .map(([id, c]) => {
        const doc = world.docs[c.documentId];
        const revoked = Object.values(world.shares).some((s) => s.documentId === c.documentId && s.revoked);
        const gone = archived.has(c.documentId);
        const params = gone || revoked ? { comment_id: id, kind: "comment" } : { comment_id: id, kind: "comment", snippet: "s", document: "D", actor: "G8 A" };
        return {
          id: `n-${id}`,
          kind: "document_mentioned",
          workspace_id: world.workspace("X", doc.workspaceKey).id,
          resource_type: "document",
          resource_id: c.documentId,
          params,
          count: 1,
          resource_deleted: gone,
          resource_access_lost: revoked && !gone,
          comment_deleted: c.deleted,
        };
      });
    return { status: 200, body: { notifications: rows } };
  });
  const app = {
    connectApp: async (opts) => {
      const ctrl = await fake.app.connectApp(opts);
      return ctrl;
    },
  };
  // the open panel lists what existed when its document opened, then refreshes on a focus (fork comments-poll);
  // a launch reveal of an id the panel has not listed is dropped (fork SheetsServerComments.tsx:282-287)
  const listed = new Set();
  const revealed = new Set();
  const openedDocs = new Set();
  const listAll = () => {
    for (const [id, c] of comments) if (!c.deleted) listed.add(id);
  };
  script.respond("app.focus", () => {
    listAll();
    return { activated: true, pages: 1 };
  });
  // the editor's thread reading: a listed live comment the launch revealed holds focus
  script.respond("app.evalBounded", (call) => {
    const [, arg, label] = call.args;
    if (label === "__genofficeControl.selection") return { status: "ok", result: { sheet: B7_SHEET_NAME, range: "B7" } };
    const c = comments.get(arg);
    if (!c || c.deleted || !listed.has(arg)) return { present: false, focusedThreadId: null, anchorState: null };
    return { present: true, focusedThreadId: revealed.has(arg) ? arg : null, anchorState: arg === "c3" ? "lost" : "exact" };
  });
  // the first sheets window of the app shows another workbook (an earlier row's tab)
  script.respond("app.selection", { status: "ok", result: { sheet: "Doanh thu Q1", range: "A1" } });
  let docPathSeq = 0;
  script.respond("app.openByTicket", (call) => {
    docPathSeq += 1;
    const documentId = call.args[1]?.documentId ?? null;
    if (!openedDocs.has(documentId)) {
      openedDocs.add(documentId);
      listAll();
    }
    const cid = /ticket=ticket_(c\d+)/.exec(call.args[0])?.[1];
    if (cid && listed.has(cid)) revealed.add(cid);
    return { path: `/fake/wc-${docPathSeq}`, documentId, kind: "sheets" };
  });
  script.respond("app.comments.list", (call) =>
    Object.values(world.shares).some((s) => s.revoked) ? { ok: false, error: { code: "forbidden", message: "x" } } : { ok: true, value: { comments: [] } },
  );
  // the Inbox reader: the href resource-href would render, from the row
  const readInbox = async (_page, { ws, notificationId }) => {
    const res = await world.session("B").call("listNotifications");
    const row = res.body.notifications.find((n) => n.id === notificationId);
    if (!row) return { listed: false, href: null, text: "" };
    return { listed: true, href: `/org-x/${hrefWorkspace}/documents/${row.resource_id}?comment=${row.params.comment_id}`, text: "", ws };
  };
  const openSignedOut = async () => ({ url: "http://127.0.0.1:8/login" });
  const opens = [];
  const web = {
    webLogin: fake.web.webLogin,
    openDocument: async (page, opts) => {
      opens.push({ user: page.user, documentId: opts.documentId, comment: opts.comment ?? null, archived: archived.has(opts.documentId) });
      const revoked = Object.values(world.shares).some((s) => s.documentId === opts.documentId && s.revoked);
      // C was never given the W1 document: 404, the gone page (Backend ID Rules); B after the revoke: S15 no-access
      if (page.user === "C") return { url: "u", status: "not-found", panelCount: 0, focusedCommentId: null };
      if (revoked) return { url: "u", status: revokedShowsGone ? "not-found" : "no-access", panelCount: 0, focusedCommentId: null };
      if (archived.has(opts.documentId)) return { url: "u", status: "not-found", panelCount: 0, focusedCommentId: null };
      const c = comments.get(opts.comment);
      if (c?.deleted) return { url: "u", status: "error", panelCount: 1, focusedCommentId: null };
      return { url: "u", status: "ok", panelCount: 1, focusedCommentId: opts.comment ?? null };
    },
  };
  return { fake, opens, deps: { web, connectApp: app.connectApp, launchBrowser: async () => fake.browser, readInbox, openSignedOut, sleep: async () => {} } };
}

const runA07 = (deps, fixture = "fx-xlsx-revenue-xyz", pin = "7d665a5") => {
  writePin("sheets.pin.json", pin);
  writePin("docs.pin.json", pin);
  return runRowModule(
    { row: "G8-A07", fixture, runDir, module: "deeplink", timeoutMs: 10_000, repoRoot: repo, worldFactory: () => deps.world },
    (ctx) => runDeeplink(ctx, { ...deps, pollMs: 0, pollTimeoutMs: 50 }),
  );
};
const artifact = (fixture = "fx-xlsx-revenue-xyz") => JSON.parse(readFileSync(rowArtifactPath(runDir, "G8-A07", fixture), "utf8"));

test("runDeeplink on a re-pinned frame: PASS with every check and the revoke steps in the artifact", async () => {
  const { fake, deps } = scriptedWorld();
  const exit = await runA07({ ...deps, world: fake.world });
  const a = artifact();
  assert.equal(exit, 0, JSON.stringify(a, null, 1));
  assert.equal(a.status, "PASS");
  for (const name of ["web-href", "web-open", "desktop-reveal", "cross-workspace", "exceptions", "revoke"]) assert.equal(a.steps[name]?.status, "PASS", name);
  // B's ticket carried the comment id read from the Inbox href
  const mints = fake.calls.api.filter((c) => c.key === "mintLaunch");
  assert.ok(mints.some((c) => c.user === "B" && c.args.body.comment_id === "c1"));
  // the main document lives in W2 (B and C read it), the cross-workspace one in W1 shared to B only
  const uploads = fake.calls.world.filter((c) => c.key === "upload").map((c) => c.args.slice(0, 2));
  assert.deepEqual(uploads.slice(0, 2), [["A", "W2"], ["A", "W1"]]);
  // no secret in the artifact
  assert.ok(!/fake-password|fake-token/.test(JSON.stringify(a)));
});

test("runDeeplink under the 05fd209 pin: exit 77 with the R1 blocker; the desktop B7 reveal still PASSes", async () => {
  const { fake, opens, deps } = scriptedWorld();
  const exit = await runA07({ ...deps, world: fake.world }, "fx-xlsx-revenue-xyz", "05fd209");
  const a = artifact();
  assert.equal(exit, 77, JSON.stringify(a.steps, null, 1));
  assert.equal(a.blocker, WEB_FRAME_PIN_BLOCKER);
  assert.equal(a.owner, WEB_FRAME_PIN_OWNER);
  assert.equal(a.steps["web-open"].status, "BLOCKED");
  assert.equal(a.steps["desktop-reveal"].status, "PASS");
  // B's web page was never asked for the in-frame panel of the main thread; the
  // only c1 open is the S15 gone check after the archive, which renders no frame
  assert.deepEqual(opens.filter((o) => o.user === "B" && o.comment === "c1").map((o) => o.archived), [true]);
});

test("runDeeplink: the Inbox href in the document's workspace while the recipient is not a member there is FAIL", async () => {
  const { fake, deps } = scriptedWorld({ hrefWorkspace: "ws-w1" });
  assert.equal(await runA07({ ...deps, world: fake.world }), 1);
  assert.equal(artifact().steps["cross-workspace"].status, "FAIL");
});

test("runDeeplink: an app that cannot be driven is FAIL, never BLOCKED", async () => {
  const { fake, deps } = scriptedWorld();
  const err = new Error("no CDP");
  err.appUnavailable = { status: "BLOCKED", reason: "no APP_CDP_PORT" };
  fake.script.respond("app.connectApp", err);
  const exit = await runA07({ ...deps, world: fake.world });
  assert.equal(exit, 1);
  assert.equal(artifact().status, "FAIL");
});

test("decideG8A07: a cross-workspace row filed under the document's workspace is a product FAIL naming the Inbox workspace filter and an owner", () => {
  const cw = { ...a07().crossWorkspace, inboxListed: false, href: null, notificationWorkspaceId: "ws-id-w1", openWorkspaceId: "ws-id-w2" };
  const r = decideG8A07(a07({ crossWorkspace: cw }));
  assert.equal(r.status, "FAIL");
  const reason = r.checks["cross-workspace"].reason;
  assert.match(reason, /product/);
  assert.match(reason, /ws-id-w1/);
  assert.match(reason, /inbox-view\.tsx:71/);
  assert.match(reason, /notifications\.sql:37/);
  assert.match(reason, /owner candidate/);
  // a row already in B's workspace that is still not listed is not blamed on the filter
  const same = decideG8A07(a07({ crossWorkspace: { ...cw, notificationWorkspaceId: "ws-id-w2" } }));
  assert.doesNotMatch(same.checks["cross-workspace"].reason, /inbox-view\.tsx/);
});

test("runDeeplink: the B7 selection is read in the page that shows the document, not the app's first sheets window", async () => {
  const { fake, deps } = scriptedWorld();
  await runA07({ ...deps, world: fake.world });
  const a = artifact();
  assert.equal(a.steps["desktop-reveal"].status, "PASS", JSON.stringify(a.steps["observe-desktop"], null, 1));
  assert.equal(a.steps["observe-desktop"].details.selectionSource, "document page");
  assert.equal(fake.calls.app.filter((c) => c.key === "selection").length, 0);
});

test("runDeeplink: the lost-anchor comment is listed by the open panel (focus refresh) before the re-launch reveals it", async () => {
  const { fake, deps } = scriptedWorld();
  await runA07({ ...deps, world: fake.world });
  const a = artifact();
  assert.equal(a.steps["observe-anchor-lost"].details.listedBeforeLaunch, true, JSON.stringify(a.steps["observe-anchor-lost"], null, 1));
  assert.equal(a.steps.exceptions.details.checks.anchor_lost.status, "PASS");
});

test("runDeeplink: a launch refused for the deleted comment is a product FAIL, and the row's comment_deleted is still recorded", async () => {
  const { fake, deps } = scriptedWorld({ launchRefusesGoneComment: true });
  assert.equal(await runA07({ ...deps, world: fake.world }), 1);
  const a = artifact();
  const step = a.steps["observe-comment-deleted"];
  assert.equal(step.status, "PASS", JSON.stringify(step, null, 1));
  assert.equal(step.details.notification.comment_deleted, true);
  assert.equal(step.details.launch.refused, true);
  assert.equal(step.details.launch.status, 404);
  assert.match(a.steps.exceptions.reason, /comment_deleted: product: /);
  assert.doesNotMatch(a.steps.exceptions.reason, /does not read comment_deleted/);
});

test("runDeeplink: C's link shows the gone page (PASS); B's revoked link on the gone page is the product FAIL in revoke and no_access", async () => {
  const { fake, deps } = scriptedWorld({ revokedShowsGone: true });
  assert.equal(await runA07({ ...deps, world: fake.world }), 1);
  const a = artifact();
  assert.equal(a.steps["observe-no-access"].details.web, "not-found");
  assert.match(a.steps.revoke.reason, /web-no-access: product: /);
  assert.match(a.steps.exceptions.reason, /no_access: product: /);
});
