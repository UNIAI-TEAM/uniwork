// G8-19 (UNI-1414) G8-A02 "anchors survive Save": the decision table, the
// web frame pin rule (R1) and the xlsx flow against the fake world.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { zipStore } from "../fixtures-lib/zip.mjs";
import { createFakeWorld } from "./fake-world.mjs";
import { B7_ANCHOR, WEB_FRAME_PIN_BLOCKER, WEB_FRAME_PIN_OWNER, exitCodeFor } from "./run-row.mjs";
import {
  CLOSED_PANEL_OWNER,
  EDIT_DRIVERS,
  FIXTURE_FORMAT,
  PANEL_OPENERS,
  anchorForFixture,
  anchorMatches,
  PURGED_CASE_NOTE,
  docxQuoteBlock,
  serverCommentMark,
  decideG8A02,
  decideWebToDesktop,
  expectedAfterShift,
  framePinBlock,
  pageAction,
  readFramePin,
  runG8A02,
} from "./anchors.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const B8 = { ...B7_ANCHOR, range: "B8" };
const bodyInvalid = { error: { code: "anchor_version_invalid", message: "phiên bản neo không hợp lệ" } };

/** The closed-panel Save on its own document: the anchor moved to the new head (xlsx). */
function closedMoved(over = {}) {
  return {
    ran: true,
    documentId: "doc-c",
    commentId: "cc",
    edited: { status: "ok" },
    saved: true,
    versionBefore: "vc-1",
    headVersionId: "vc-2",
    expected: B8,
    row: { id: "cc", anchor: B8, anchor_state: "exact", anchor_version_id: "vc-2", deleted_at: null },
    scenario: ESTABLISHED,
    ...over,
  };
}

/** The cross-host order a closed-panel run must show: opened, the editor's first list seen, then the comment. */
const ESTABLISHED = Object.freeze({ openedAt: 1_000, listedAt: 2_000, listedVia: "server.log", listLine: "GET /api/v1/documents/doc-c/comments 200", createdAt: 3_000, createdVia: "REST as A", listsBeforeSave: 0 });

/** The docx anchor of the fixture's block 2 quote, at `path`. */
function docxAnchor(path = [2]) {
  return { format: "docx", v: 1, path, start: 0, end: 20, quote: "Tổng doanh thu quý 1", prefix: "", suffix: " đạt 22.060.000 đồng." };
}

/** A record where every sub-step passed (xlsx), the web frame pin already re-pinned. */
function passingRecord(over = {}) {
  return {
    format: "xlsx",
    created: { ok: true, commentId: "c1", anchor: B7_ANCHOR, versionId: "ver-1", replyId: "r1" },
    shift: {
      edited: { status: "ok" },
      saved: true,
      versionBefore: "ver-1",
      headVersionId: "ver-2",
      expected: B8,
      row: { id: "c1", anchor: B8, anchor_state: "exact", anchor_version_id: "ver-2", deleted_at: null },
    },
    restSeesMoved: { anchor: B8, anchor_version_id: "ver-2" },
    remove: {
      edited: { status: "ok" },
      saved: true,
      headVersionId: "ver-3",
      row: { id: "c1", anchor: B8, anchor_state: "lost", anchor_version_id: "ver-2", deleted_at: null },
      replies: 1,
    },
    invalidVersions: [
      { case: "foreign", status: 400, body: bodyInvalid },
      { case: "unknown", status: 400, body: bodyInvalid },
      { case: "empty", status: 400, body: bodyInvalid },
    ],
    afterInvalid: { anchor: B8, anchor_state: "lost", anchor_version_id: "ver-2" },
    webToDesktop: { status: "PASS" },
    closedPanel: closedMoved(),
    ...over,
  };
}

test("decideG8A02: insert row above B7 -> B8, exact, on the new version; delete -> lost; three equal 400s -> PASS", () => {
  const d = decideG8A02(passingRecord());
  assert.equal(d.status, "PASS", JSON.stringify(d));
  for (const name of ["check:create", "check:shift", "check:rest-sees-moved", "check:remove-lost", "check:invalid-versions", "check:web-to-desktop"]) {
    assert.equal(d.steps[name]?.status, "PASS", name);
  }
});

test("decideG8A02: the web -> desktop direction is BLOCKED(R1) while the web frame pin is old, never PASS", () => {
  const d = decideG8A02(passingRecord({ webToDesktop: { status: "BLOCKED", blocker: WEB_FRAME_PIN_BLOCKER, owner: WEB_FRAME_PIN_OWNER } }));
  assert.equal(d.status, "BLOCKED");
  assert.equal(d.blocker, WEB_FRAME_PIN_BLOCKER);
  assert.equal(d.owner, WEB_FRAME_PIN_OWNER);
  assert.equal(exitCodeFor(d.status), 77);
});

test("decideG8A02: a desktop failure wins over the R1 block (FAIL, not BLOCKED)", () => {
  const rec = passingRecord({ webToDesktop: { status: "BLOCKED", blocker: WEB_FRAME_PIN_BLOCKER, owner: WEB_FRAME_PIN_OWNER } });
  rec.shift.row = { ...rec.shift.row, anchor: B7_ANCHOR };
  assert.equal(decideG8A02(rec).status, "FAIL");
});

for (const [label, mutate, pattern] of [
  ["the anchor did not move (still B7)", (r) => (r.shift.row.anchor = B7_ANCHOR), /B7/],
  ["the anchor stayed on the old version", (r) => (r.shift.row.anchor_version_id = "ver-1"), /version/],
  ["the head did not move (Save made no version)", (r) => (r.shift.headVersionId = "ver-1"), /version/],
  ["the state is stale, not exact", (r) => (r.shift.row.anchor_state = "stale"), /stale/],
  ["the edit driver failed", (r) => (r.shift.edited = { status: "error", reason: "no Insert row button" }), /Insert row/],
  ["the Save failed", (r) => (r.shift.saved = false), /save/i],
]) {
  test(`decideG8A02 shift: ${label} -> FAIL`, () => {
    const rec = passingRecord();
    mutate(rec);
    const d = decideG8A02(rec);
    assert.equal(d.status, "FAIL");
    assert.equal(d.steps["check:shift"].status, "FAIL");
    assert.match(d.steps["check:shift"].reason, pattern);
  });
}

test("decideG8A02 remove: exact instead of lost, a deleted thread, lost replies, or a moved stored anchor -> FAIL", () => {
  for (const mutate of [
    (r) => (r.remove.row.anchor_state = "exact"),
    (r) => (r.remove.row = null),
    (r) => (r.remove.row.deleted_at = "2026-10-15T00:00:00Z"),
    (r) => (r.remove.replies = 0),
    (r) => (r.remove.row.anchor_version_id = "ver-3"),
  ]) {
    const rec = passingRecord();
    mutate(rec);
    assert.equal(decideG8A02(rec).steps["check:remove-lost"].status, "FAIL", mutate.toString());
  }
});

test("decideG8A02 invalid versions: the three 400 bodies must be byte-equal anchor_version_invalid and write nothing", () => {
  const differ = passingRecord();
  differ.invalidVersions[1] = { case: "unknown", status: 400, body: { error: { code: "anchor_version_invalid", message: "other" } } };
  assert.match(decideG8A02(differ).steps["check:invalid-versions"].reason, /byte-equal/);
  const notFound = passingRecord();
  notFound.invalidVersions[0] = { case: "foreign", status: 404, body: { error: { code: "not_found" } } };
  assert.equal(decideG8A02(notFound).steps["check:invalid-versions"].status, "FAIL");
  const two = passingRecord({ invalidVersions: passingRecord().invalidVersions.slice(0, 2) });
  assert.equal(decideG8A02(two).steps["check:invalid-versions"].status, "FAIL");
  const wrote = passingRecord({ afterInvalid: { anchor: B7_ANCHOR, anchor_state: "exact", anchor_version_id: "ver-9" } });
  assert.match(decideG8A02(wrote).steps["check:invalid-versions"].reason, /written/);
});

test("decideG8A02: a structural edit the product does not offer is BLOCKED with its named blocker (MISSING), never PASS", () => {
  const rec = passingRecord();
  rec.shift = { status: "BLOCKED", blocker: "MISSING: no structural edit", owner: "lead-f" };
  const d = decideG8A02(rec);
  assert.equal(d.status, "BLOCKED");
  assert.match(d.blocker, /MISSING/);
});

test("framePinBlock: 05fd209 is BLOCKED(R1); a pin that contains G8-12..15 or an unknown newer one is not", () => {
  assert.deepEqual(framePinBlock({ gitSha: "05fd209", file: "sheets.pin.json" }), { status: "BLOCKED", blocker: WEB_FRAME_PIN_BLOCKER, owner: WEB_FRAME_PIN_OWNER, pin: "05fd209" });
  assert.equal(framePinBlock({ gitSha: "7d665a54" }, { isAncestor: () => true }), null);
  assert.equal(framePinBlock({ gitSha: "abcdef1" }, { isAncestor: () => null }), null);
  assert.equal(framePinBlock({ gitSha: "abcdef1" }, { isAncestor: (commit) => commit !== "f9a5a7742" })?.status, "BLOCKED");
  assert.match(framePinBlock({ gitSha: "abcdef1" }, { isAncestor: () => false }).blocker, /abcdef1 lacks G8-12\.\.15/);
  assert.equal(framePinBlock(null)?.status, "BLOCKED", "no pin file: the frame cannot carry the adapters");
});

test("readFramePin reads apps/web/platform/office-frame/<editor>.pin.json at run time, so a re-pin flips R1", () => {
  assert.equal(readFramePin(REPO_ROOT, "xlsx").gitSha, "05fd209");
  const root = mkdtempSync(join(tmpdir(), "g819-pin-"));
  mkdirSync(join(root, "apps/web/platform/office-frame"), { recursive: true });
  writeFileSync(join(root, "apps/web/platform/office-frame/docs.pin.json"), JSON.stringify({ version: "0.1.0-7d665a5", gitSha: "7d665a5" }));
  assert.deepEqual(readFramePin(root, "docx"), { file: "apps/web/platform/office-frame/docs.pin.json", gitSha: "7d665a5", version: "0.1.0-7d665a5" });
  assert.equal(readFramePin(root, "pptx"), null);
});

test("anchors per fixture follow the fork codecs; expectedAfterShift and anchorMatches", () => {
  assert.deepEqual(Object.values(FIXTURE_FORMAT).sort(), ["docx", "pdf", "pptx", "xlsx"]);
  assert.deepEqual(anchorForFixture("fx-xlsx-revenue-xyz", { repoRoot: REPO_ROOT }), B7_ANCHOR);
  const docx = anchorForFixture("fx-docx-report-vi", { repoRoot: REPO_ROOT });
  assert.equal(docx.format, "docx");
  assert.deepEqual(docx.path, [2]);
  assert.match(docx.quote, /^Tổng doanh thu quý 1/);
  const pptx = anchorForFixture("fx-pptx-deck-vi", { repoRoot: REPO_ROOT });
  assert.deepEqual(pptx, { format: "pptx", v: 1, slide_id: "257", slide_index: 1 });
  const pdf = anchorForFixture("fx-pdf-invoice-vi", { repoRoot: REPO_ROOT });
  assert.equal(pdf.page, 2);

  assert.deepEqual(expectedAfterShift(B7_ANCHOR), B8);
  assert.deepEqual(expectedAfterShift(docx).path, [3]);
  assert.equal(expectedAfterShift(pptx).slide_index, 2);
  assert.equal(expectedAfterShift(pptx).slide_id, "257");
  assert.equal(expectedAfterShift(pdf).page, 1);

  assert.equal(anchorMatches(B8, { ...B8 }), true);
  assert.equal(anchorMatches(B8, B7_ANCHOR), false);
  assert.equal(anchorMatches(expectedAfterShift(docx), { ...docx, path: [3], start: 0 }), true, "docx compares path + quote");
  assert.equal(anchorMatches({ format: "pdf", v: 1, page: 1, rect: [1, 2, 3, 4] }, { format: "pdf", v: 1, page: 1, rect: [1, 2, 3, 4.001] }), true);
});

test("EDIT_DRIVERS: every format has a shift and a remove plan driven through product commands, each citing the fork", () => {
  for (const format of ["docx", "xlsx", "pptx", "pdf"]) {
    const d = EDIT_DRIVERS[format];
    assert.ok(Array.isArray(d.shift) && d.shift.length > 0, `${format} shift`);
    assert.ok(Array.isArray(d.remove) && d.remove.length > 0, `${format} remove`);
    assert.match(d.cites.join(" "), /\.tsx?:\d+/, `${format} cites a fork file:line`);
  }
  const xlsx = EDIT_DRIVERS.xlsx.shift;
  // the panel opener leaves Review active: Insert row lives on Home (fork ExcelShell.tsx:3985-3995)
  assert.deepEqual(xlsx[0], { type: "click", selector: ".ribbon-tab", name: "^(Home|Trang đầu)$", unlessActive: true });
  assert.deepEqual(xlsx[1], { type: "control", req: { cmd: "goto", target: { kind: "range", sheet: "Doanh thu Q2", range: "A7" } } });
  assert.equal(xlsx[2].type, "click");
  assert.match("Insert row", new RegExp(xlsx[2].name));
  assert.match("Chèn hàng", new RegExp(xlsx[2].name));
  assert.deepEqual(EDIT_DRIVERS.xlsx.remove[0], xlsx[0], "the remove plan goes back to Home too");
  for (const plan of [EDIT_DRIVERS.pdf.prepare, EDIT_DRIVERS.pdf.shift, EDIT_DRIVERS.pdf.remove]) {
    for (const a of plan.filter((x) => x.selector === ".ribbon-tab")) assert.equal(a.unlessActive, true, "a second press on the active tab collapses the ribbon");
  }
  assert.ok(Array.isArray(EDIT_DRIVERS.pdf.prepare), "pdf needs pages before it can move or lose one");
});

test("PANEL_OPENERS: per editor the ribbon tab + the control that opens the server comments panel, en and vi labels, citing the fork", () => {
  const labels = {
    docx: { tab: ["Review", "Xem lại"], button: ["Show Comments", "Hiện nhận xét"] },
    xlsx: { tab: ["Review", "Xem lại"], button: ["🗨Show Comments", "Show Comments", "Hiện nhận xét"] },
    pptx: { tab: ["Review", "Xem lại"], button: ["Comments Pane", "Ngăn nhận xét (3)"] },
    pdf: { tab: ["Annotate", "Chú thích"], button: [] },
  };
  for (const [format, want] of Object.entries(labels)) {
    const o = PANEL_OPENERS[format];
    assert.ok(o, format);
    assert.match(o.cites.join(" "), /\.tsx?:\d+/, `${format} cites a fork file:line`);
    const [tab, button] = o.plan;
    assert.equal(o.plan.length, 2, format);
    assert.deepEqual([tab.type, tab.selector, tab.unlessActive], ["click", ".ribbon-tab", true], format);
    for (const l of want.tab) assert.match(l, new RegExp(tab.name), `${format} tab ${l}`);
    assert.equal(button.type, "click");
    for (const l of want.button) assert.match(l, new RegExp(button.name), `${format} button ${l}`);
  }
  assert.equal(PANEL_OPENERS.pdf.plan[1].selector, "#pdf-server-comments-toggle");
  assert.doesNotMatch("Comments", new RegExp(PANEL_OPENERS.docx.plan[1].name), "r1 looked for a bare Comments button that no editor has");
});

test("pageAction click unlessActive: an active ribbon tab is not pressed again (that collapses the ribbon)", async () => {
  const saved = globalThis.document;
  const el = (cls) => ({ clicked: 0, textContent: "Home", disabled: false, classList: { contains: (c) => cls.includes(c) }, getAttribute: () => null, click() { this.clicked += 1; } });
  try {
    for (const [cls, want] of [[["ribbon-tab", "active"], 0], [["ribbon-tab"], 1]]) {
      const tab = el(cls);
      globalThis.document = { querySelectorAll: () => [tab] };
      const res = await pageAction({ type: "click", selector: ".ribbon-tab", name: "^Home$", unlessActive: true, settleMs: 0 });
      assert.equal(res.status, "ok");
      assert.equal(tab.clicked, want, cls.join(" "));
    }
  } finally {
    globalThis.document = saved;
  }
});

// ---- the flow against the fake -------------------------------------------------

function fakeCtx(fake, fixture) {
  const steps = {};
  const runDir = mkdtempSync(join(tmpdir(), "g819-a02-"));
  mkdirSync(join(runDir, "logs"));
  // the harness server log (harness/start.sh): the fake app appends the editor's mount-time list to it
  fake.serverLog = join(runDir, "logs", "server.log");
  writeFileSync(fake.serverLog, "");
  return {
    row: "G8-A02",
    fixture,
    runDir,
    repoRoot: REPO_ROOT,
    portsEnv: { HARNESS_DEPLOYMENT_ID: "dep-1" },
    apiOrigin: "http://127.0.0.1:1",
    webOrigin: "http://127.0.0.1:2",
    steps,
    getWorld: async () => fake.world,
    async step(name, fn) {
      try {
        const out = await fn();
        steps[name] = { status: "PASS", ...(out && typeof out === "object" ? out : {}) };
      } catch (err) {
        steps[name] = { status: "FAIL", reason: err.message };
      }
      return steps[name];
    },
    block: (blocker, owner = "") => ({ status: "BLOCKED", blocker, owner }),
    log() {},
  };
}

const CLOSED_DOC = "doc-3";
const CLOSED_PATH = `/wc/${CLOSED_DOC}.xlsx`;

/** What the server logs when an editor lists a document's comments (server/internal/middleware/request_logger.go, tint text). */
function logEditorList(fake, documentId, status = 200) {
  if (fake.serverLog) appendFileSync(fake.serverLog, `07:50:04.332 INF http request method=GET path=/api/v1/documents/${documentId}/comments status=${status} duration=2.1ms request_id=r-1\n`);
}

/**
 * Scripts a server that moves the anchor on the first Save after the shift and loses it after the remove.
 * The closed-panel document (doc-3, uploaded third) has its own row "cc": its Save moves it to B8 on the
 * new head unless `state.closedStays` (the r1 behaviour: the editor never listed it).
 */
function scriptXlsxServer(fake) {
  const state = { head: "ver-1", anchor: null, anchorState: null, anchorVersion: null, saves: 0, comment: null };
  const closed = { head: "vc-1", row: null, saves: 0 };
  state.closed = closed;
  const docOf = (call) => call.args.pathParams?.documentID;
  fake.script.respond("api.mintLaunch", { status: 201, body: { launch_url: "uniwork-office-dev://open?ticket=t1" } });
  fake.script.respond("app.openByTicket", (call) => {
    const id = call.args[1]?.documentId ?? "doc-1";
    // the editor mounts and its controller lists once (use-collab-threads.ts:455-475), unless scripted not to
    if (!state.noMountList) logEditorList(fake, id);
    return { path: id === CLOSED_DOC ? CLOSED_PATH : "/wc/doc.xlsx", documentId: id, kind: "sheets" };
  });
  fake.script.respond("app.comments.context", (call) =>
    call.args[0].path === CLOSED_PATH ? { ok: true, value: { documentId: CLOSED_DOC, versionId: closed.head } } : { ok: true, value: { documentId: "doc-1", versionId: state.head } },
  );
  // the closed-panel comment arrives from another host (REST) while the desktop shows the document
  state.createAnswer = (call) => {
    const b = call.args.body;
    closed.row = { id: "cc", body: b.body, anchor: b.anchor, anchor_state: "exact", anchor_version_id: b.base_version_id, deleted_at: null, parent_id: null };
    return { status: 201, body: { comment: closed.row } };
  };
  fake.script.respond("api.createDocumentComment", (call) => state.createAnswer(call));
  fake.script.respond("app.comments.create", (call) => {
    const input = call.args[0];
    if (input.parentId) return { ok: true, value: { comment: { id: "r1", parent_id: input.parentId } } };
    state.anchor = input.anchor;
    state.anchorState = "exact";
    state.anchorVersion = input.baseVersionId;
    state.comment = { id: "c1", body: input.body };
    return { ok: true, value: { comment: { id: "c1", anchor: input.anchor, anchor_state: "exact", anchor_version_id: input.baseVersionId } } };
  });
  // the editor's own comments panel lists the root once the comment exists
  fake.script.respond("app.evalBounded", (call) => {
    const [, arg, label] = call.args;
    if (label === "probe:listed") return { panels: state.panel ? 1 : 0, commentIds: state.panel && state.comment && !state.unlisted ? ["c1"] : [] };
    if (arg?.selector === "button.styles-row") state.panel = true;
    return { status: "ok" };
  });
  fake.script.respond("app.save", (call) => {
    if (call.args[0] === CLOSED_PATH) {
      closed.saves += 1;
      closed.head = `vc-${closed.saves + 1}`;
      if (!state.closedStays) closed.row = { ...closed.row, anchor: { ...closed.row.anchor, range: "B8" }, anchor_version_id: closed.head };
      return { state: "saved" };
    }
    state.saves += 1;
    state.head = `ver-${state.saves + 1}`;
    if (state.saves === 1) {
      state.anchor = { ...state.anchor, range: "B8" };
      state.anchorVersion = state.head;
    } else if (state.saves === 2) {
      state.anchorState = "lost";
    }
    return { state: "saved" };
  });
  state.docAnswer = (call) =>
    docOf(call) === CLOSED_DOC
      ? { status: 200, body: { document: { id: CLOSED_DOC, file: { version_id: closed.head } } } }
      : { status: 200, body: { document: { id: "doc-1", file: { version_id: state.head } } } };
  state.listAnswer = (call) =>
    docOf(call) === CLOSED_DOC
      ? { status: 200, body: { comments: closed.row ? [closed.row] : [], list_token: `c-${closed.saves}` } }
      : {
          status: 200,
          body: {
            comments: [
              { id: "c1", body: state.comment?.body, anchor: state.anchor, anchor_state: state.anchorState, anchor_version_id: state.anchorVersion, deleted_at: null, parent_id: null },
              { id: "r1", parent_id: "c1", body: "reply", deleted_at: null },
            ],
            list_token: `lt-${state.saves}`,
          },
        };
  fake.script.respond("api.getDocument", (call) => state.docAnswer(call));
  fake.script.respond("api.listDocumentComments", (call) => state.listAnswer(call));
  fake.script.respond("api.putDocumentCommentAnchors", { status: 400, body: bodyInvalid });
  return state;
}

/**
 * The web -> desktop document (doc-4, uploaded fourth): A comments on B7 over REST, the web
 * frame's Save moves it to B8 on the saved version, and the desktop list reads it there.
 */
function scriptWebDoc(fake, xlsx, { webSave = null } = {}) {
  const web = { head: "ver-3", row: null, saves: 0 };
  const isWeb = (call) => call.args.pathParams.documentID === "doc-4";
  fake.script.respond("api.getDocument", (call) =>
    isWeb(call) ? { status: 200, body: { document: { id: "doc-4", file: { version_id: web.head } } } } : xlsx.docAnswer(call),
  );
  fake.script.respond("api.listDocumentComments", (call) =>
    isWeb(call) ? { status: 200, body: { comments: web.row ? [web.row] : [], list_token: `w-${web.saves}` } } : xlsx.listAnswer(call),
  );
  fake.script.respond("api.createDocumentComment", (call) => {
    if (!isWeb(call)) return xlsx.createAnswer(call);
    const b = call.args.body;
    web.row = { id: "cw", body: b.body, anchor: b.anchor, anchor_state: "exact", anchor_version_id: b.base_version_id, deleted_at: null, parent_id: null };
    return { status: 201, body: { comment: web.row } };
  });
  fake.script.respond(
    "web.webSave",
    webSave ??
      (() => {
        web.saves += 1;
        web.head = `ver-web-${web.saves}`;
        web.row = { ...web.row, anchor: { ...web.row.anchor, range: "B8" }, anchor_version_id: web.head };
        return { status: "saved", versionId: web.head, revision: String(web.saves + 1), version: web.saves + 1 };
      }),
  );
  fake.script.respond("web.webFrameEval", { status: "ok" });
  fake.script.respond("app.comments.list", (call) =>
    call.args[0].path === "/wc/doc-4.xlsx" ? { ok: true, value: { comments: web.row ? [web.row] : [], listToken: "d" } } : { ok: true, value: { comments: [], listToken: "x" } },
  );
  fake.script.respond("app.openByTicket", (call) => {
    const id = call.args[1]?.documentId ?? "doc-1";
    logEditorList(fake, id);
    return { path: id === "doc-1" ? "/wc/doc.xlsx" : `/wc/${id}.xlsx`, documentId: id, kind: "sheets" };
  });
  return web;
}

const REPINNED = { framePin: { gitSha: "abc1234", file: "sheets.pin.json" }, isAncestor: () => true };

test("runG8A02 after a re-pin: the web frame's Save moves A's B7 comment to B8 and the desktop reads it there -> PASS", async () => {
  const fake = createFakeWorld();
  const xlsx = scriptXlsxServer(fake);
  scriptWebDoc(fake, xlsx);
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, web: fake.web, launchBrowser: async () => fake.browser, ...REPINNED });
  assert.equal(record.status, "PASS", JSON.stringify(record.steps, null, 1));
  assert.equal(record.steps["check:web-to-desktop"].status, "PASS");
  const w = record.details.webToDesktop;
  assert.equal(w.documentId, "doc-4");
  assert.equal(w.saved.versionId, "ver-web-1");
  assert.equal(w.desktopRow.anchor.range, "B8");
  const created = fake.calls.api.find((c) => c.key === "createDocumentComment" && c.args.pathParams.documentID === "doc-4");
  assert.equal(created.user, "A");
  assert.deepEqual(created.args.body.anchor, B7_ANCHOR);
  assert.equal(created.args.body.base_version_id, "ver-3");
  const saves = fake.calls.web.filter((c) => c.key === "webSave");
  assert.deepEqual(saves.map((c) => c.args[1].kind), ["sheets"]);
  const frameEdits = fake.calls.web.filter((c) => c.key === "webFrameEval").map((c) => c.args[2]);
  assert.deepEqual(frameEdits, EDIT_DRIVERS.xlsx.shift, "the desktop shift plan runs in the web frame");
  assert.ok(fake.calls.web.some((c) => c.key === "webLogin" && c.args[0] === "A"));
});

test("runG8A02 after a re-pin: a web Save that makes no version is FAIL on check:web-to-desktop", async () => {
  const fake = createFakeWorld();
  const xlsx = scriptXlsxServer(fake);
  scriptWebDoc(fake, xlsx, { webSave: { status: "timeout", reason: "no frame commit within the bound (the frame was not dirty)" } });
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, web: fake.web, launchBrowser: async () => fake.browser, ...REPINNED });
  assert.equal(record.status, "FAIL");
  assert.equal(record.steps["check:web-to-desktop"].status, "FAIL");
  assert.match(record.steps["check:web-to-desktop"].reason, /web Save: timeout/);
});

test("runG8A02 on the old pin: the web direction is BLOCKED(R1) without opening a browser", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  let launched = 0;
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), {
    connectApp: fake.app.connectApp,
    sleep: async () => {},
    web: fake.web,
    launchBrowser: async () => (launched += 1, fake.browser),
    framePin: { gitSha: "05fd209" },
  });
  assert.equal(record.steps["check:web-to-desktop"].status, "BLOCKED");
  assert.equal(launched, 0);
  assert.equal(fake.calls.web.length, 0);
});

test("runG8A02 artifact says why the purged-version case is the empty id", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, framePin: { gitSha: "05fd209" } });
  assert.equal(record.details.invalidVersionsNote, PURGED_CASE_NOTE);
  assert.equal(
    PURGED_CASE_NOTE,
    "purged-version case replaced by empty id: no REST purge route (router/documents.go), same single lookup document_comment_anchors.go:362-369",
  );
});

test("decideWebToDesktop: saved version, exact moved row on it, desktop reads the same; a preset BLOCKED/FAIL passes through", () => {
  const good = {
    ran: true,
    expected: B8,
    saved: { status: "saved", versionId: "vw" },
    serverRow: { anchor: B8, anchor_state: "exact", anchor_version_id: "vw" },
    desktopRow: { anchor: B8, anchor_version_id: "vw" },
  };
  assert.deepEqual(decideWebToDesktop(good), { status: "PASS" });
  assert.match(decideWebToDesktop({ ...good, serverRow: { ...good.serverRow, anchor_version_id: "v1" } }).reason, /anchor stayed on version v1, the web Save made vw/);
  assert.match(decideWebToDesktop({ ...good, desktopRow: { anchor: B7_ANCHOR, anchor_version_id: "vw" } }).reason, /desktop reads .*B7/);
  assert.match(decideWebToDesktop({ ...good, desktopRow: null }).reason, /desktop list has no row/);
  assert.deepEqual(decideWebToDesktop({ status: "BLOCKED", blocker: "b", owner: "o" }), { status: "BLOCKED", blocker: "b", owner: "o" });
  assert.deepEqual(decideWebToDesktop({ status: "FAIL", reason: "r" }), { status: "FAIL", reason: "r" });
  assert.equal(decideWebToDesktop(undefined).status, "FAIL");
});

test("runG8A02 (xlsx, fake): upload, desktop comment on B7, insert row + Save -> B8, delete + Save -> lost, three 400s, R1 BLOCKED", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  const ctx = fakeCtx(fake, "fx-xlsx-revenue-xyz");
  const record = await runG8A02(ctx, { connectApp: fake.app.connectApp, sleep: async () => {}, framePin: { gitSha: "05fd209", file: "sheets.pin.json" } });
  assert.equal(record.status, "BLOCKED", JSON.stringify(record, null, 1));
  assert.equal(record.blocker, WEB_FRAME_PIN_BLOCKER);
  for (const [name, step] of Object.entries(record.steps)) {
    if (name !== "check:web-to-desktop") assert.equal(step.status, "PASS", `${name}: ${step.reason ?? ""}`);
  }
  assert.equal(record.details.shift.row.anchor.range, "B8");
  assert.equal(record.details.remove.row.anchor_state, "lost");

  const created = fake.calls.app.find((c) => c.key === "comments.create" && !c.args[0].parentId && c.args[0].path !== CLOSED_PATH);
  assert.deepEqual(created.args[0].anchor, B7_ANCHOR);
  assert.equal(created.args[0].baseVersionId, "ver-1");
  const mint = fake.calls.api.find((c) => c.key === "mintLaunch");
  assert.equal(mint.args.body.deployment_id, "dep-1");
  const puts = fake.calls.api.filter((c) => c.key === "putDocumentCommentAnchors").map((c) => c.args.body.version_id);
  assert.equal(puts.length, 3);
  assert.equal(new Set(puts).size, 3, "foreign, unknown and empty are three different version ids");
  const edits = fake.calls.app.filter((c) => c.key === "evalBounded").map((c) => c.args[1]);
  assert.ok(edits.some((a) => a?.type === "click" && new RegExp(a.name).test("Insert row")), "the Insert row command was driven");
  assert.ok(edits.some((a) => a?.type === "click" && new RegExp(a.name).test("Delete row")), "the Delete row command was driven");
});

test("runG8A02: an app that cannot be driven is FAIL (never BLOCKED)", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  const err = new Error("could not connect");
  err.appUnavailable = { status: "BLOCKED", reason: "no CDP" };
  fake.script.respond("app.connectApp", err);
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, framePin: { gitSha: "05fd209" } });
  assert.equal(record.status, "FAIL");
  assert.match(record.reason, /could not connect|no CDP/);
});

test("runG8A02 opens the editor's comments panel and waits until the editor lists the comment before the shift edit", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  const ctx = fakeCtx(fake, "fx-xlsx-revenue-xyz");
  const record = await runG8A02(ctx, { connectApp: fake.app.connectApp, sleep: async () => {}, framePin: { gitSha: "05fd209" } });
  assert.equal(ctx.steps["editor-lists"]?.status, "PASS", JSON.stringify(ctx.steps));
  assert.equal(record.details.editorLists.listed, true);
  // the panel-open path starts after the closed-panel document's Save
  const after = fake.calls.app.slice(fake.calls.app.findIndex((c) => c.key === "save" && c.args[0] === CLOSED_PATH) + 1);
  const evals = after.filter((c) => c.key === "evalBounded").map((c) => c.args[2]);
  const opened = evals.indexOf("edit:click:1");
  const listed = evals.lastIndexOf("probe:listed");
  const inserted = evals.findIndex((l, i) => i > listed && l.startsWith("edit:"));
  assert.ok(opened >= 0 && listed > opened && inserted > listed, `opener, then the listing, then the edit: ${evals.join(",")}`);
  const actions = after.filter((c) => c.key === "evalBounded").map((c) => c.args[1]);
  assert.deepEqual(actions.slice(1, 1 + PANEL_OPENERS.xlsx.plan.length), PANEL_OPENERS.xlsx.plan);
});

test("runG8A02: an editor that never lists the comment is FAIL at editor-lists and drives no edit", async () => {
  const fake = createFakeWorld();
  const state = scriptXlsxServer(fake);
  state.unlisted = true;
  let t = 0;
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, now: () => (t += 5_000), framePin: { gitSha: "05fd209" } });
  assert.equal(record.status, "FAIL");
  assert.match(record.reason, /^editor-lists: .*did not list comment c1/);
  assert.equal(fake.calls.app.filter((c) => c.key === "save" && c.args[0] !== CLOSED_PATH).length, 0, "no Save without a tracked anchor");
});

test("decideG8A02 remove: the kept-version rule speaks only about a lost row (an exact row already fails on its state)", () => {
  const rec = passingRecord();
  rec.remove.row = { ...rec.remove.row, anchor_state: "exact", anchor_version_id: "ver-3" };
  const reason = decideG8A02(rec).steps["check:remove-lost"].reason;
  assert.match(reason, /anchor_state exact, want lost/);
  assert.doesNotMatch(reason, /keep its last version/);
  const lostMoved = passingRecord();
  lostMoved.remove.row.anchor_version_id = "ver-3";
  assert.match(decideG8A02(lostMoved).steps["check:remove-lost"].reason, /keep its last version ver-2, got ver-3/);
});


test("decideG8A02 closed-panel Save: an anchor that moved to the new head with the panel closed -> that check PASS", () => {
  const d = decideG8A02(passingRecord());
  assert.equal(d.steps["check:closed-panel-save"]?.status, "PASS", JSON.stringify(d.steps["check:closed-panel-save"]));
  assert.equal(d.status, "PASS");
  assert.equal(Object.keys(d.steps)[0], "check:closed-panel-save", "it runs first and is listed first");
});

test("decideG8A02 closed-panel Save: an anchor the round never covered (exact on the old version) is FAIL naming the one-list-at-mount controller and the format's round", () => {
  for (const format of ["xlsx", "docx", "pptx", "pdf"]) {
    const rec = passingRecord({ format, closedPanel: closedMoved({ row: { id: "cc", anchor: B7_ANCHOR, anchor_state: "exact", anchor_version_id: "vc-1", deleted_at: null } }) });
    const d = decideG8A02(rec);
    const c = d.steps["check:closed-panel-save"];
    assert.equal(c.status, "FAIL", format);
    assert.match(c.reason, /^desktop did not re-anchor this comment on Save: it was made after the editor's first list \([^)]*\), and the editor's round covers only the roots its comments controller has listed \(apps\/[a-z]+\/src\/renderer\/[^)]*\.tsx?:\d+-\d+\)/, format);
    assert.match(c.reason, /packages\/ui\/src\/collab\/use-collab-threads\.ts:455-475/, `${format}: one list at mount`);
    assert.match(c.reason, /packages\/electron-utils\/src\/comments-poll\.ts:128-131/, `${format}: no reload with the panel closed`);
    assert.match(c.reason, /vc-1.*vc-2/, `${format}: the observed versions are in the reason`);
    assert.equal(c.owner, CLOSED_PANEL_OWNER);
    assert.equal(CLOSED_PANEL_OWNER, "g8-fork_editors / Lead F");
    assert.equal(d.status, "FAIL", `${format}: not BLOCKED, not hidden`);
  }
  const pdf = decideG8A02(passingRecord({ format: "pdf", closedPanel: closedMoved({ row: { id: "cc", anchor: { format: "pdf", v: 1, page: 2, rect: [72, 700, 96, 724] }, anchor_state: "exact", anchor_version_id: "vc-1" } }) }));
  assert.match(pdf.steps["check:closed-panel-save"].reason, /PdfServerComments\.tsx:178-202/);
  assert.match(pdf.steps["check:closed-panel-save"].reason, /made after the editor's first list \(opened 1000, listed 2000 by server\.log, created 3000\)/, "the observed order is the proof");
  assert.match(pdf.steps["check:closed-panel-save"].reason, /no list request between the comment and the Save/);
  assert.doesNotMatch(pdf.steps["check:closed-panel-save"].reason, /prepare Save/, "the order comes from the record, not from the plan");
  // the editor listed again before the Save and still left it: the one-list/poll-gate cites do not explain that
  const relisted = decideG8A02(passingRecord({ format: "pptx", closedPanel: closedMoved({ scenario: { ...ESTABLISHED, listsBeforeSave: 2 }, row: { id: "cc", anchor: B7_ANCHOR, anchor_state: "exact", anchor_version_id: "vc-1" } }) })).steps["check:closed-panel-save"];
  assert.equal(relisted.status, "FAIL");
  assert.match(relisted.reason, /although 2 list requests for the document reached the server between the comment and the Save/);
  assert.doesNotMatch(relisted.reason, /comments-poll|use-collab-threads/, "only code that explains the result is cited");
});

test("decideG8A02 closed-panel Save: a comment that does not postdate the editor's first list proves nothing -> FAIL scenario not established (harness, no owner)", () => {
  const cases = [
    ["made before the first list", { ...ESTABLISHED, createdAt: 1_500 }, /comment created 1500 is not after the editor's first list 2000/],
    ["made at the same instant", { ...ESTABLISHED, createdAt: 2_000 }, /comment created 2000 is not after the editor's first list 2000/],
    ["no first list seen", { ...ESTABLISHED, listedAt: null, listedVia: null }, /no list request of the editor was seen after the open/],
    ["listed before the open", { ...ESTABLISHED, listedAt: 500 }, /first list 500 is before the open 1000/],
    ["nothing recorded", undefined, /no scenario was recorded/],
  ];
  for (const [label, scenario, re] of cases) {
    // even a row that moved exactly as wanted is no proof when the order is not established
    const c = decideG8A02(passingRecord({ closedPanel: closedMoved({ scenario }) })).steps["check:closed-panel-save"];
    assert.equal(c.status, "FAIL", label);
    assert.match(c.reason, /^scenario not established: /, label);
    assert.match(c.reason, re, label);
    assert.equal(c.owner, undefined, `${label}: a harness fault has no product owner`);
  }
});

test("decideG8A02 closed-panel Save PASS says why the round covered a comment made after the first list", () => {
  const relisted = decideG8A02(passingRecord({ closedPanel: closedMoved({ scenario: { ...ESTABLISHED, listsBeforeSave: 1 } }) })).steps["check:closed-panel-save"];
  assert.equal(relisted.status, "PASS");
  assert.match(relisted.note, /the editor listed the document again \(1 list request between the comment and the Save\), so its round \(apps\/sheets\/src\/renderer\/server-comments\/SheetsServerComments\.tsx:207-213\) covered it/);
  const quiet = decideG8A02(passingRecord({ closedPanel: closedMoved() })).steps["check:closed-panel-save"];
  assert.equal(quiet.status, "PASS");
  assert.match(quiet.note, /no list request reached the server between the comment and the Save, yet the round \(apps\/sheets\/src\/renderer\/server-comments\/SheetsServerComments\.tsx:207-213\), built from the listed roots, re-anchored it/);
});

test("decideG8A02 closed-panel Save: a row the desktop reported lost is the round's own answer, never the panel gate; docx names the post-Save reload", () => {
  const lost = { id: "cc", anchor: { ...docxAnchor() }, anchor_state: "lost", anchor_version_id: "vc-1" };
  const docx = decideG8A02(passingRecord({ format: "docx", closedPanel: closedMoved({ expected: docxAnchor([3]), row: lost, headQuote: { block: 3 }, marks: { beforeEdit: 1, afterEdit: 1, afterSave: 0 } }) })).steps["check:closed-panel-save"];
  assert.equal(docx.status, "FAIL");
  assert.equal(docx.owner, CLOSED_PANEL_OWNER);
  assert.match(docx.reason, /^desktop reported the anchor lost on Save/);
  assert.doesNotMatch(docx.reason, /comments-poll|panel closed/, "the round ran: the panel gate does not explain a lost row");
  assert.match(docx.reason, /apps\/docs\/src\/renderer\/file-actions\.ts:1125-1148/);
  assert.match(docx.reason, /anchor-tracker\.ts:79-91/);
  assert.match(docx.reason, /anchor-sync\.ts:25-31/);
  assert.match(docx.reason, /document_comment_anchors\.go:434-440/);
  assert.match(docx.reason, /saved head holds the quote at block 3/);
  assert.match(docx.reason, /highlight before edit 1, after edit 1, after Save 0/);
  const pptx = decideG8A02(passingRecord({ format: "pptx", closedPanel: closedMoved({ row: { ...lost, anchor: { format: "pptx", v: 1, slide_id: "257", slide_index: 1 } } }) })).steps["check:closed-panel-save"];
  assert.match(pptx.reason, /^desktop reported the anchor lost on Save/);
  assert.doesNotMatch(pptx.reason, /file-actions|comments-poll/, "only code that explains the failure is cited");
});

test("decideG8A02 docx: a saved head whose quote is not at the expected block is the edit driver's fault (harness), not a product FAIL", () => {
  const lost = { id: "cc", anchor: docxAnchor(), anchor_state: "lost", anchor_version_id: "vc-1" };
  const c = decideG8A02(passingRecord({ format: "docx", closedPanel: closedMoved({ expected: docxAnchor([3]), row: lost, headQuote: { block: 2 } }) })).steps["check:closed-panel-save"];
  assert.equal(c.status, "FAIL");
  assert.match(c.reason, /^edit driver: the saved head holds the quote at block 2, want 3/);
  assert.equal(c.owner, undefined, "a harness fault has no product owner");
  const none = decideG8A02(passingRecord({ format: "docx", closedPanel: closedMoved({ expected: docxAnchor([3]), row: lost, headQuote: { block: null } }) })).steps["check:closed-panel-save"];
  assert.match(none.reason, /^edit driver: the saved head no longer holds the quote/);
});

test("decideG8A02 shift: a lost row says the desktop reported lost (the server keeps the version), with the docx reason; remove after an already-lost row is not observed", () => {
  const rec = passingRecord({ format: "docx" });
  rec.created = { ok: true, commentId: "c1", anchor: docxAnchor(), versionId: "ver-1" };
  rec.shift = { ...rec.shift, expected: docxAnchor([3]), headQuote: { block: 3 }, row: { id: "c1", anchor: docxAnchor(), anchor_state: "lost", anchor_version_id: "ver-1", deleted_at: null } };
  rec.restSeesMoved = { anchor: docxAnchor(), anchor_version_id: "ver-1" };
  rec.remove.row = { ...rec.shift.row };
  rec.afterInvalid = { ...rec.shift.row };
  const d = decideG8A02(rec);
  assert.match(d.steps["check:shift"].reason, /^desktop reported the anchor lost on Save, want exact at path \[3\]/);
  assert.match(d.steps["check:shift"].reason, /file-actions\.ts:1125-1148/);
  assert.doesNotMatch(d.steps["check:shift"].reason, /anchor stayed on version/);
  assert.equal(d.steps["check:remove-lost"].status, "FAIL");
  assert.match(d.steps["check:remove-lost"].reason, /not observed: the row was already lost after the shift Save/);
});

test("docxQuoteBlock: the top-level block that holds the quote, empty <w:p/> paragraphs counted", () => {
  const xml = (body) => zipStore([{ name: "word/document.xml", data: `<w:document><w:body>${body}<w:sectPr/></w:body></w:document>` }]);
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  assert.equal(docxQuoteBlock(xml(`<w:p/>${p("")}${p("Tiêu đề")}${p("Tổng doanh thu quý 1 đạt")}`), "Tổng doanh thu quý 1"), 3);
  assert.equal(docxQuoteBlock(xml(`<w:p w14:paraId="1"/>${p("Tổng doanh thu quý 1")}`), "Tổng doanh thu quý 1"), 1);
  assert.equal(docxQuoteBlock(xml(p("khác")), "Tổng doanh thu quý 1"), null);
});

test("serverCommentMark counts the docx highlights of one comment (fork anchor-tracker.ts:49,58-61)", () => {
  const saved = globalThis.document;
  const el = (id, text) => ({ getAttribute: (n) => (n === "data-server-comment" ? id : null), textContent: text });
  globalThis.document = { querySelectorAll: (sel) => (sel === "[data-server-comment]" ? [el("c1", "Tổng doanh"), el("c1", " thu"), el("c2", "x")] : []) };
  try {
    assert.deepEqual(serverCommentMark({ commentId: "c1" }), { marks: 2, text: "Tổng doanh thu" });
    assert.deepEqual(serverCommentMark({ commentId: "c9" }), { marks: 0, text: "" });
  } finally {
    globalThis.document = saved;
  }
});

test("decideG8A02 closed-panel Save: moved but wrong place, a failed edit or Save, or a part that did not run -> FAIL with that reason", () => {
  const wrong = decideG8A02(passingRecord({ closedPanel: closedMoved({ row: { id: "cc", anchor: B7_ANCHOR, anchor_state: "exact", anchor_version_id: "vc-2" } }) })).steps["check:closed-panel-save"];
  assert.equal(wrong.status, "FAIL");
  assert.match(wrong.reason, /anchor at sheet-2!B7, want sheet-2!B8/);
  assert.doesNotMatch(wrong.reason, /stays on the old version/);
  assert.match(decideG8A02(passingRecord({ closedPanel: closedMoved({ edited: { status: "error", reason: "no Insert row" } }) })).steps["check:closed-panel-save"].reason, /edit driver: no Insert row/);
  assert.match(decideG8A02(passingRecord({ closedPanel: { status: "FAIL", reason: "upload: boom" } })).steps["check:closed-panel-save"].reason, /upload: boom/);
  assert.equal(decideG8A02(passingRecord({ closedPanel: undefined })).steps["check:closed-panel-save"].status, "FAIL");
});

test("runG8A02 runs the closed-panel Save first on its own document: no opener before its edit, row FAIL with the product reason when the anchor stays", async () => {
  const fake = createFakeWorld();
  const state = scriptXlsxServer(fake);
  state.closedStays = true;
  let t = 0;
  const ctx = fakeCtx(fake, "fx-xlsx-revenue-xyz");
  const record = await runG8A02(ctx, { connectApp: fake.app.connectApp, sleep: async () => {}, now: () => (t += 1_000), framePin: { gitSha: "05fd209" } });
  assert.deepEqual(Object.keys(ctx.steps).slice(0, 3), ["upload", "closed-panel-save", "open-desktop"], JSON.stringify(Object.keys(ctx.steps)));
  const c = record.steps["check:closed-panel-save"];
  assert.equal(c.status, "FAIL");
  assert.match(c.reason, /^desktop did not re-anchor this comment on Save: .*the server anchor stays on the old version/);
  assert.equal(record.status, "FAIL");
  assert.equal(record.steps["check:shift"].status, "PASS", "the panel-open path is still its own check");
  assert.equal(fake.calls.app.find((c2) => c2.key === "comments.create" && c2.args[0].path === CLOSED_PATH), undefined, "the closed-panel comment comes from another host");
  const closedCreate = fake.calls.api.find((c2) => c2.key === "createDocumentComment" && c2.args.pathParams.documentID === CLOSED_DOC);
  assert.equal(closedCreate.user, "A");
  assert.deepEqual(closedCreate.args.body.anchor, B7_ANCHOR);
  assert.equal(closedCreate.args.body.base_version_id, "vc-1");
  const order = fake.calls.app.filter((c2) => ["comments.create", "save", "evalBounded"].includes(c2.key)).map((c2) => (c2.key === "evalBounded" ? c2.args[2] : `${c2.key}:${c2.args[0]?.path ?? c2.args[0]}`));
  const closedSave = order.indexOf(`save:${CLOSED_PATH}`);
  assert.ok(closedSave > 0, order.join(","));
  assert.ok(!order.slice(0, closedSave).includes("probe:listed"), "the panel is never opened for the closed-panel document");
  assert.equal(record.details.closedPanel.documentId, CLOSED_DOC);
});

test("runG8A02 closed-panel Save that moves the anchor: that check PASS, the rest unchanged", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, framePin: { gitSha: "05fd209" } });
  assert.equal(record.steps["check:closed-panel-save"].status, "PASS", JSON.stringify(record.details.closedPanel));
  assert.equal(record.status, "BLOCKED", "only R1 is left");
});

test("runG8A02 asks for the editor page that shows each document by path (two documents of one kind are open)", async () => {
  const fake = createFakeWorld();
  scriptXlsxServer(fake);
  await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, framePin: { gitSha: "05fd209" } });
  const asked = fake.calls.app.filter((c) => c.key === "editorPage").map((c) => c.args);
  assert.deepEqual(asked, [
    ["sheets", { path: CLOSED_PATH, documentId: CLOSED_DOC }],
    ["sheets", { path: "/wc/doc.xlsx", documentId: "doc-1" }],
  ]);
});

/**
 * The r2 docx behaviour: every Save round answers lost (the row keeps its version), the editor's
 * highlight is there until the Save and gone after it, and the saved head holds the quote at block 3.
 */
function scriptDocxServer(fake) {
  const docs = {
    "doc-1": { head: 1, row: null },
    "doc-3": { head: 1, row: null },
  };
  const state = { marks: 0, panel: false };
  const idOfPath = (path) => (path === "/wc/doc-3.docx" ? "doc-3" : "doc-1");
  fake.script.respond("api.mintLaunch", { status: 201, body: { launch_url: "uniwork-office-dev://open?ticket=t1" } });
  fake.script.respond("app.openByTicket", (call) => {
    const id = call.args[1]?.documentId ?? "doc-1";
    logEditorList(fake, id);
    return { path: `/wc/${id}.docx`, documentId: id, kind: "docs" };
  });
  fake.script.respond("api.createDocumentComment", (call) => {
    const b = call.args.body;
    const id = docOf(call);
    docs[id].row = { id: id === "doc-3" ? "cc" : "c1", body: b.body, anchor: b.anchor, anchor_state: "exact", anchor_version_id: b.base_version_id, deleted_at: null, parent_id: null };
    return { status: 201, body: { comment: docs[id].row } };
  });
  fake.script.respond("app.comments.context", (call) => ({ ok: true, value: { documentId: idOfPath(call.args[0].path), versionId: `${idOfPath(call.args[0].path)}-v${docs[idOfPath(call.args[0].path)].head}` } }));
  fake.script.respond("app.comments.create", (call) => {
    const input = call.args[0];
    const d = docs[idOfPath(input.path)];
    if (input.parentId) return { ok: true, value: { comment: { id: "r1", parent_id: input.parentId } } };
    d.row = { id: idOfPath(input.path) === "doc-3" ? "cc" : "c1", anchor: input.anchor, anchor_state: "exact", anchor_version_id: input.baseVersionId, deleted_at: null, parent_id: null };
    d.tracked = true;
    state.marks = 1;
    return { ok: true, value: { comment: d.row } };
  });
  fake.script.respond("app.evalBounded", (call) => {
    const [, arg, label] = call.args;
    if (label === "probe:listed") return { panels: state.panel ? 1 : 0, commentIds: state.panel ? ["c1"] : [] };
    if (label === "probe:mark") return { marks: state.marks, text: state.marks ? "Tổng doanh thu quý 1" : "" };
    if (arg?.selector === "button.rb-big") state.panel = true;
    return { status: "ok" };
  });
  fake.script.respond("app.save", (call) => {
    const d = docs[idOfPath(call.args[0])];
    d.head += 1;
    // only a root the editor tracks is in its round (a REST comment made after the first list is not)
    if (d.row && d.tracked) d.row = { ...d.row, anchor_state: "lost" };
    state.marks = 0;
    return { state: "saved" };
  });
  const docOf = (call) => call.args.pathParams?.documentID;
  fake.script.respond("api.getDocument", (call) => {
    const id = docOf(call);
    const d = docs[id] ?? docs["doc-1"];
    return { status: 200, body: { document: { id, file: { version_id: `${id}-v${d.head}`, version: d.head } } } };
  });
  fake.script.respond("api.listDocumentComments", (call) => {
    const d = docs[docOf(call)] ?? { row: null };
    return { status: 200, body: { comments: d.row ? [d.row, { id: "r1", parent_id: d.row.id, deleted_at: null }] : [], list_token: "t" } };
  });
  fake.script.respond("api.putDocumentCommentAnchors", { status: 400, body: bodyInvalid });
  return { docs, state };
}

test("runG8A02 (docx, fake): records the highlight around each Save and the saved head's quote block, and a lost row ends the wait at once", async () => {
  const fake = createFakeWorld();
  scriptDocxServer(fake);
  const p = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const head = zipStore([{ name: "word/document.xml", data: `<w:document><w:body>${p("")}${p("")}${p("1. Tóm tắt")}${p("Tổng doanh thu quý 1 đạt")}</w:body></w:document>` }]);
  const downloads = [];
  let t = 0;
  const record = await runG8A02(fakeCtx(fake, "fx-docx-report-vi"), {
    connectApp: fake.app.connectApp,
    sleep: async () => {},
    now: () => (t += 1_000),
    framePin: { gitSha: "05fd209" },
    download: async (documentId, version) => {
      downloads.push([documentId, version]);
      return head;
    },
  });
  const closed = record.details.closedPanel;
  // made after the first list, the comment is not in the docs round (it has no highlight either)
  assert.deepEqual(closed.marks, { beforeEdit: 0, afterEdit: 0, afterSave: 0 });
  assert.deepEqual(closed.headQuote, { block: 3, version: 2 });
  assert.match(record.steps["check:closed-panel-save"].reason, /^desktop did not re-anchor this comment on Save: it was made after the editor's first list/);
  assert.match(record.steps["check:closed-panel-save"].reason, /ServerCommentsHost\.tsx:194-203/);
  assert.doesNotMatch(record.steps["check:closed-panel-save"].reason, /file-actions/, "the reload does not explain a root the round never had");
  assert.deepEqual(record.details.shift.marks, { beforeEdit: 1, afterEdit: 1, afterSave: 0 });
  assert.match(record.steps["check:shift"].reason, /^desktop reported the anchor lost on Save, want exact at path \[3\]/);
  assert.equal(record.steps["check:remove-lost"].status, "FAIL");
  assert.deepEqual(downloads, [["doc-3", 2], ["doc-1", 2]]);
  assert.equal(record.status, "FAIL");
});

test("runG8A02 closed panel: the comment is made over REST only after the server log shows the editor's first list, and the order is recorded", async () => {
  const fake = createFakeWorld();
  const state = scriptXlsxServer(fake);
  state.closedStays = true;
  let t = 0;
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, now: () => (t += 1_000), framePin: { gitSha: "05fd209" } });
  const sc = record.details.closedPanel.scenario;
  assert.ok(sc.openedAt <= sc.listedAt && sc.listedAt < sc.createdAt, JSON.stringify(sc));
  assert.equal(sc.listedVia, "server.log");
  assert.match(sc.listLine, /GET \/api\/v1\/documents\/doc-3\/comments 200 at 07:50:04\.332/);
  assert.equal(sc.createdVia, "REST as A (another host, the desktop panel closed)");
  assert.equal(sc.listsBeforeSave, 0);
  assert.equal(record.details.closedPanel.createdAfterSave, undefined, "the order is observed, never inferred from the plan");
  assert.equal(record.details.closedPanel.marks, undefined, "highlights are a docx probe only");
  // the harness itself never lists the closed-panel document before its Save (that would read as an editor list)
  const closedSave = fake.calls.all.findIndex((c) => c.area === "app" && c.key === "save" && c.args[0] === CLOSED_PATH);
  assert.ok(closedSave > 0);
  const firstList = fake.calls.all.findIndex((c) => c.area === "api" && c.key === "listDocumentComments" && c.args.pathParams.documentID === CLOSED_DOC);
  assert.ok(firstList > closedSave, "no harness list of doc-3 before its Save");
  assert.match(record.steps["check:closed-panel-save"].reason, /^desktop did not re-anchor this comment on Save: it was made after the editor's first list/);
});

test("runG8A02 closed panel: no editor list in the server log -> the comment is not made and the check FAILs scenario not established", async () => {
  const fake = createFakeWorld();
  const state = scriptXlsxServer(fake);
  state.noMountList = true;
  let t = 0;
  const record = await runG8A02(fakeCtx(fake, "fx-xlsx-revenue-xyz"), { connectApp: fake.app.connectApp, sleep: async () => {}, now: () => (t += 1_000), framePin: { gitSha: "05fd209" } });
  const c = record.steps["check:closed-panel-save"];
  assert.equal(c.status, "FAIL");
  assert.match(c.reason, /^scenario not established: no list request of the editor was seen after the open/);
  assert.equal(c.owner, undefined);
  assert.equal(fake.calls.api.filter((x) => x.key === "createDocumentComment" && x.args.pathParams.documentID === CLOSED_DOC).length, 0);
  assert.equal(fake.calls.app.filter((x) => x.key === "save" && x.args[0] === CLOSED_PATH).length, 0, "no edit or Save without the scenario");
  assert.equal(record.details.closedPanel.scenario.listedAt, null);
});
