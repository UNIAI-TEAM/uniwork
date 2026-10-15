// G8-19 (UNI-1414) comments across hosts: G8-A01 (one server row, the UniWork
// author, no machine name in the saved file or any payload; the AI clause is
// cited from the fork vitest, lead decision Q2) and G8-A04 (one data set for
// two hosts: desktop sees a web change on focus within 35 s, the web reads a
// desktop change, concurrent sends are two rows, offline is read-only and keeps
// the draft), plus the G8-A03 rename/copy add-on reported in the A04 artifact.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { zipStore } from "../fixtures-lib/zip.mjs";
import { createFakeWorld } from "./fake-world.mjs";
import { WEB_FRAME_PIN_BLOCKER, WEB_FRAME_PIN_OWNER, exitCodeFor } from "./run-row.mjs";
import {
  A04_DESKTOP_BOUND_MS,
  AI_CLAUSE,
  decideA03AddOn,
  decideG8A01,
  decideG8A04,
  runG8A01,
  runG8A04,
  waitDesktopSees,
} from "./comments.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MACHINE = "zone17th";

// ---- G8-A01 -------------------------------------------------------------------------

function a01Record(over = {}) {
  return {
    format: "xlsx",
    marker: "G8-A01 marker",
    userId: "user-A",
    create: { ok: true, commentId: "c1" },
    rows: [{ id: "c1", body: "G8-A01 marker", author_id: "user-A", author_kind: "human", anchor: { format: "xlsx", v: 1, sheet: "sheet-2", range: "B7" } }],
    webRows: [{ id: "c1" }],
    scan: { kind: "zip", names: [MACHINE], skipped: [{ name: "User", reason: "neutral" }], hits: [], parts: ["xl/workbook.xml"], commentParts: [] },
    payloadHits: [],
    saved: true,
    ...over,
  };
}

test("decideG8A01: one row, author A (human), the fixture's anchor format, no machine name -> PASS; the AI clause is cited, not tested", () => {
  const d = decideG8A01(a01Record());
  assert.equal(d.status, "PASS", JSON.stringify(d));
  assert.deepEqual(d.aiOnlyProposes, AI_CLAUSE);
  assert.equal(AI_CLAUSE.covered_by, "fork-vitest G8-12..15");
  assert.equal(Object.values(d.steps).some((s) => s.status === "BLOCKED"), false, "Q2: the AI clause never makes A01 BLOCKED");
});

for (const [label, over, step, pattern] of [
  ["two rows for one create", { rows: [a01Record().rows[0], { ...a01Record().rows[0], id: "c2" }] }, "check:one-row", /2 rows/],
  ["the row is not the created id", { create: { ok: true, commentId: "cX" } }, "check:one-row", /cX/],
  ["another author", { rows: [{ ...a01Record().rows[0], author_id: "user-B" }] }, "check:author", /user-B/],
  ["an agent author", { rows: [{ ...a01Record().rows[0], author_kind: "agent" }] }, "check:author", /agent/],
  ["a docx anchor on an xlsx", { rows: [{ ...a01Record().rows[0], anchor: { format: "docx" } }] }, "check:anchor-format", /docx/],
  ["the web reader does not see the row", { webRows: [] }, "check:web-sees-row", /B/],
  ["the machine name in a saved part", { scan: { ...a01Record().scan, hits: [{ name: MACHINE, part: "xl/persons/person.xml", offset: 42 }] } }, "check:file-scan", /xl\/persons\/person\.xml@42/],
  ["no name left to scan for", { scan: { ...a01Record().scan, names: [] } }, "check:file-scan", /no machine name/],
  ["the machine name in a payload", { payloadHits: [{ name: MACHINE, part: "payload:list", offset: 3 }] }, "check:payload-scan", /payload:list/],
  ["the desktop create failed", { create: { ok: false, error: "comments.create -> network" } }, "check:create", /network/],
  ["the Save failed", { saved: false }, "check:file-scan", /Save/],
]) {
  test(`decideG8A01: ${label} -> FAIL`, () => {
    const d = decideG8A01(a01Record(over));
    assert.equal(d.status, "FAIL");
    assert.equal(d.steps[step].status, "FAIL", JSON.stringify(d.steps));
    assert.match(d.steps[step].reason, pattern);
  });
}

// ---- G8-A04 -------------------------------------------------------------------------

function a04Record(over = {}) {
  return {
    webToDesktop: { created: true, seen: true, elapsedMs: 31_000, focusForced: true },
    desktopToWebRest: { created: true, seen: true },
    desktopToWebRealtime: { status: "PASS" },
    mutations: [
      { op: "edit", from: "desktop", ok: true, seen: true },
      { op: "resolve", from: "desktop", ok: true, seen: true },
      { op: "reopen", from: "desktop", ok: true, seen: true },
      { op: "edit", from: "web", ok: true, seen: true, elapsedMs: 4_000 },
      { op: "resolve", from: "web", ok: true, seen: true, elapsedMs: 4_000 },
    ],
    hardDelete: { deleted: true, tokenChanged: true, goneOnDesktop: true, elapsedMs: 5_000 },
    concurrent: { statuses: [201, 201], ids: ["k1", "k2"], rows: 2 },
    offline: { draftTyped: true, readOnly: true, sendBlocked: true, draftKept: true, recovered: true, draftKeptAfter: true },
    panels: { desktop: 1, web: { status: "PASS", count: 1 } },
    ...over,
  };
}

const r1 = { status: "BLOCKED", blocker: WEB_FRAME_PIN_BLOCKER, owner: WEB_FRAME_PIN_OWNER };

test("decideG8A04: every host sees the other, two rows, offline read-only with the draft -> PASS", () => {
  const d = decideG8A04(a04Record());
  assert.equal(d.status, "PASS", JSON.stringify(d.steps));
});

test("decideG8A04: the web panel in an old frame is BLOCKED(R1) (exit 77), never PASS", () => {
  const d = decideG8A04(a04Record({ desktopToWebRealtime: r1, panels: { desktop: 1, web: r1 } }));
  assert.equal(d.status, "BLOCKED");
  assert.equal(d.blocker, WEB_FRAME_PIN_BLOCKER);
  assert.equal(exitCodeFor(d.status), 77);
});

test("decideG8A04: the desktop must see a web change on focus within 30 s poll + 5 s (35 s)", () => {
  assert.equal(A04_DESKTOP_BOUND_MS, 35_000);
  const late = decideG8A04(a04Record({ webToDesktop: { created: true, seen: true, elapsedMs: 35_001, focusForced: true } }));
  assert.equal(late.steps["check:web-to-desktop"].status, "FAIL");
  assert.match(late.steps["check:web-to-desktop"].reason, /35001 ms/);
  const unseen = decideG8A04(a04Record({ webToDesktop: { created: true, seen: false, elapsedMs: 35_000, focusForced: true } }));
  assert.equal(unseen.status, "FAIL");
  const noFocus = decideG8A04(a04Record({ webToDesktop: { created: true, seen: true, elapsedMs: 1_000, focusForced: false } }));
  assert.match(noFocus.steps["check:web-to-desktop"].reason, /focus/);
  const lateMutation = a04Record();
  lateMutation.mutations[3] = { op: "edit", from: "web", ok: true, seen: true, elapsedMs: 40_000 };
  assert.equal(decideG8A04(lateMutation).steps["check:mutations"].status, "FAIL");
});

test("decideG8A04: offline must be read-only (status line + Send blocked), keep the draft, and recover", () => {
  for (const field of ["readOnly", "sendBlocked", "draftKept", "recovered", "draftKeptAfter", "draftTyped"]) {
    const rec = a04Record();
    rec.offline = { ...rec.offline, [field]: false };
    const d = decideG8A04(rec);
    assert.equal(d.steps["check:offline"].status, "FAIL", field);
  }
});

test("decideG8A04: concurrent sends must be two rows with two ids; a hard delete must change list_token and leave the desktop", () => {
  assert.equal(decideG8A04(a04Record({ concurrent: { statuses: [201, 201], ids: ["k1", "k1"], rows: 1 } })).steps["check:concurrent"].status, "FAIL");
  assert.equal(decideG8A04(a04Record({ concurrent: { statuses: [201, 409], ids: ["k1"], rows: 1 } })).steps["check:concurrent"].status, "FAIL");
  assert.equal(decideG8A04(a04Record({ hardDelete: { deleted: true, tokenChanged: false, goneOnDesktop: true } })).steps["check:hard-delete"].status, "FAIL");
  assert.equal(decideG8A04(a04Record({ hardDelete: { deleted: true, tokenChanged: true, goneOnDesktop: false } })).steps["check:hard-delete"].status, "FAIL");
  assert.equal(decideG8A04(a04Record({ panels: { desktop: 2, web: { status: "PASS", count: 1 } } })).steps["check:one-panel-desktop"].status, "FAIL");
});

test("decideA03AddOn: the discussion survives a rename (same id, one thread) and a copy carries no comments", () => {
  const ok = { discussionId: "d1", afterRename: { ids: ["d1"], titleChanged: true }, copy: { copyId: "doc-9", comments: 0 } };
  assert.equal(decideA03AddOn(ok).status, "PASS");
  assert.equal(decideA03AddOn({ ...ok, afterRename: { ids: ["d1", "d2"], titleChanged: true } }).status, "FAIL");
  assert.equal(decideA03AddOn({ ...ok, afterRename: { ids: ["d2"], titleChanged: true } }).status, "FAIL");
  assert.equal(decideA03AddOn({ ...ok, afterRename: { ids: ["d1"], titleChanged: false } }).status, "FAIL");
  assert.match(decideA03AddOn({ ...ok, copy: { copyId: "doc-9", comments: 1 } }).reason, /copy/);
});

test("waitDesktopSees forces a focus before every probe and gives up at the bound", async () => {
  let t = 0;
  const focuses = [];
  const ctrl = { focus: async (path) => (focuses.push(path), { activated: true, pages: 1 }) };
  const seenAt = await waitDesktopSees({ ctrl, path: "/wc/a", probe: async () => t >= 30_000, pred: (v) => v, sleep: async (ms) => void (t += ms), now: () => t });
  assert.equal(seenAt.seen, true);
  assert.ok(seenAt.elapsedMs <= A04_DESKTOP_BOUND_MS);
  assert.equal(seenAt.focusForced, true);
  assert.ok(focuses.length >= 2 && focuses.every((p) => p === "/wc/a"));
  t = 0;
  const never = await waitDesktopSees({ ctrl, path: "/wc/a", probe: async () => false, pred: (v) => v, sleep: async (ms) => void (t += ms), now: () => t });
  assert.equal(never.seen, false);
  assert.ok(never.elapsedMs >= A04_DESKTOP_BOUND_MS && never.elapsedMs < A04_DESKTOP_BOUND_MS + 5_000);
});

// ---- flows against the fake -----------------------------------------------------------

function fakeCtx(fake, row, fixture) {
  const steps = {};
  return {
    row,
    fixture,
    runDir: mkdtempSync(join(tmpdir(), "g819-cm-")),
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

function scriptA01(fake, author) {
  const server = { rows: [] };
  fake.script.respond("api.mintLaunch", { status: 201, body: { launch_url: "uniwork-office-dev://open?ticket=t1" } });
  fake.script.respond("app.openByTicket", (call) => ({ path: "/wc/report.docx", documentId: call.args[1]?.documentId, kind: "docs" }));
  fake.script.respond("app.comments.context", { ok: true, value: { documentId: "doc-1", versionId: "ver-1", myUserId: "user-A" } });
  fake.script.respond("app.comments.create", (call) => {
    const row = { id: "c1", body: call.args[0].body, author_id: "user-A", author_kind: "human", display_name: author, anchor: call.args[0].anchor };
    server.rows.push(row);
    return { ok: true, value: { comment: row } };
  });
  fake.script.respond("app.save", { state: "saved" });
  fake.script.respond("api.listDocumentComments", () => ({ status: 200, body: { comments: server.rows, list_token: "lt1" } }));
  fake.script.respond("api.getDocument", { status: 200, body: { document: { id: "doc-1", file: { version_id: "ver-2" } } } });
  return server;
}

const savedDocx = (author) => zipStore([{ name: "word/document.xml", data: "<w:document/>" }, { name: "word/comments.xml", data: `<w:comments><w:comment w:author="${author}"/></w:comments>` }]);

test("runG8A01 (docx, fake): the desktop comment is one server row by A, and the saved file + payloads are clean -> PASS", async () => {
  const fake = createFakeWorld();
  scriptA01(fake, "G8 A");
  const ctx = fakeCtx(fake, "G8-A01", "fx-docx-report-vi");
  const record = await runG8A01(ctx, { connectApp: fake.app.connectApp, readFile: async () => savedDocx("G8 A"), machine: { names: [MACHINE], skipped: [], sources: {} } });
  assert.equal(record.status, "PASS", JSON.stringify(record, null, 1));
  const create = fake.calls.app.find((c) => c.key === "comments.create");
  assert.equal(create.args[0].anchor.format, "docx");
  assert.equal(create.args[0].baseVersionId, "ver-1");
  assert.ok(fake.calls.app.some((c) => c.key === "save"), "the document is saved before the scan");
  assert.deepEqual(record.details.scan.commentParts, ["word/comments.xml"]);
  assert.deepEqual(record.details.aiOnlyProposes, AI_CLAUSE);
});

test("runG8A01 (docx, fake): the machine name in the saved comments.xml or the author payload -> FAIL", async () => {
  const fake = createFakeWorld();
  scriptA01(fake, MACHINE);
  const record = await runG8A01(fakeCtx(fake, "G8-A01", "fx-docx-report-vi"), {
    connectApp: fake.app.connectApp,
    readFile: async () => savedDocx(MACHINE),
    machine: { names: [MACHINE], skipped: [], sources: {} },
  });
  assert.equal(record.status, "FAIL");
  assert.match(record.reason, /word\/comments\.xml@/);
  assert.match(record.reason, /payload/);
});

test("runG8A04 (xlsx, fake): web create seen on desktop after focus, desktop create read by B, R1 BLOCKED, A03 add-on in details", async () => {
  const fake = createFakeWorld();
  const server = { rows: [], token: 0, title: "G8-A04" };
  const bump = () => `lt-${++server.token}`;
  let online = true;
  let draft = "";
  fake.script.respond("api.mintLaunch", { status: 201, body: { launch_url: "uniwork-office-dev://open?ticket=t1" } });
  fake.script.respond("app.openByTicket", (call) => ({ path: "/wc/rev.xlsx", documentId: call.args[1]?.documentId, kind: "sheets" }));
  fake.script.respond("app.comments.context", { ok: true, value: { documentId: "doc-1", versionId: "ver-1" } });
  let seq = 0;
  const add = (body, author, extra = {}) => {
    const row = { id: `k${++seq}`, body, author_id: author, author_kind: "human", resolved_at: null, deleted_at: null, parent_id: null, kind: "comment", ...extra };
    server.rows.push(row);
    bump();
    return row;
  };
  fake.script.respond("app.comments.create", (call) => (online ? { ok: true, value: { comment: add(call.args[0].body, "user-A", { kind: call.args[0].kind }) } } : { ok: false, error: { code: "network" } }));
  fake.script.respond("app.comments.update", (call) => {
    const row = server.rows.find((r) => r.id === call.args[0].commentId);
    row.body = call.args[0].body;
    bump();
    return { ok: true, value: { comment: row } };
  });
  const setResolved = (id, v) => {
    const row = server.rows.find((r) => r.id === id);
    row.resolved_at = v;
    bump();
    return row;
  };
  fake.script.respond("app.comments.resolve", (call) => ({ ok: true, value: { comment: setResolved(call.args[0].commentId, "now") } }));
  fake.script.respond("app.comments.reopen", (call) => ({ ok: true, value: { comment: setResolved(call.args[0].commentId, null) } }));
  fake.script.respond("app.comments.list", (call) => {
    if (!online) return { ok: false, error: { code: "network" } };
    const token = `lt-${server.token}`;
    if (call.args[0].sinceToken === token) return { ok: true, value: { comments: [], list_token: token, unchanged: true } };
    return { ok: true, value: { comments: server.rows.filter((r) => !r.gone), list_token: token, unchanged: false } };
  });
  fake.script.respond("app.discussion.create", (call) => ({ ok: true, value: { comment: add(call.args[0].body, "user-A", { kind: "discussion" }) } }));
  fake.script.respond("app.aiOffice.uniworkRenameDocument", (call) => {
    server.title = call.args[1];
    return { ok: true };
  });
  fake.script.respond("app.evalBounded", (call) => {
    const name = call.args[2];
    if (name === "probe:panel") {
      const live = server.rows.filter((r) => !r.gone && r.kind === "comment");
      return { panels: 1, commentIds: live.map((r) => r.id), warn: !online, composer: true, draft, sendDisabled: !online };
    }
    if (name === "draft:type") {
      draft = call.args[1].text;
      return { ok: true };
    }
    return { status: "ok" };
  });
  const sB = (name, fn) => fake.script.respond(`api.${name}`, fn);
  sB("createDocumentComment", (call) => ({ status: 201, body: { comment: add(call.args.body.body, call.user === "B" ? "user-B" : "user-A") } }));
  sB("listDocumentComments", (call) => {
    const kind = call.args.query?.kind;
    const docRows = call.args.pathParams.documentID === "doc-copy" ? [] : server.rows.filter((r) => !r.gone && (!kind || r.kind === kind));
    return { status: 200, body: { comments: docRows, list_token: `lt-${server.token}` } };
  });
  sB("updateDocumentComment", (call) => {
    const row = server.rows.find((r) => r.id === call.args.pathParams.commentID);
    row.body = call.args.body.body;
    bump();
    return { status: 200, body: { comment: row } };
  });
  sB("resolveDocumentComment", (call) => ({ status: 200, body: { comment: setResolved(call.args.pathParams.commentID, "now") } }));
  sB("deleteDocumentComment", (call) => {
    server.rows.find((r) => r.id === call.args.pathParams.commentID).gone = true;
    bump();
    return { status: 200, body: { outcome: "removed" } };
  });
  sB("getDocument", () => ({ status: 200, body: { document: { id: "doc-1", title: server.title, revision: "3", file: { version_id: "ver-1" } } } }));
  sB("copyDocument", { status: 201, body: { document: { id: "doc-copy" } } });

  const ctx = fakeCtx(fake, "G8-A04", "fx-xlsx-revenue-xyz");
  const record = await runG8A04(ctx, {
    connectApp: fake.app.connectApp,
    sleep: async () => {},
    framePin: { gitSha: "05fd209" },
    setOnline: (_runDir, value) => {
      online = value;
    },
  });
  assert.equal(record.status, "BLOCKED", JSON.stringify(record, null, 1));
  assert.equal(record.blocker, WEB_FRAME_PIN_BLOCKER);
  for (const [name, step] of Object.entries(record.steps)) {
    if (!["check:desktop-to-web-realtime", "check:one-panel-web"].includes(name)) assert.equal(step.status, "PASS", `${name}: ${step.reason ?? ""}`);
  }
  assert.equal(online, true, "the app proxy is back online at the end");
  assert.equal(record.details.g8A03AddOn.status, "PASS", JSON.stringify(record.details.g8A03AddOn));
  assert.ok(fake.calls.app.filter((c) => c.key === "focus").length >= 2, "the desktop poll is forced by focus");
  const created = fake.calls.api.filter((c) => c.key === "createDocumentComment" && c.user === "B");
  assert.ok(created.length >= 2, "B creates over REST (web create) and in the concurrent pair");
});
