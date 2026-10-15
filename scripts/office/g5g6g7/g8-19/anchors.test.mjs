// G8-19 (UNI-1414) G8-A02 "anchors survive Save": the decision table, the
// web frame pin rule (R1) and the xlsx flow against the fake world.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createFakeWorld } from "./fake-world.mjs";
import { B7_ANCHOR, WEB_FRAME_PIN_BLOCKER, WEB_FRAME_PIN_OWNER, exitCodeFor } from "./run-row.mjs";
import {
  EDIT_DRIVERS,
  FIXTURE_FORMAT,
  anchorForFixture,
  anchorMatches,
  decideG8A02,
  expectedAfterShift,
  framePinBlock,
  readFramePin,
  runG8A02,
} from "./anchors.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const B8 = { ...B7_ANCHOR, range: "B8" };
const bodyInvalid = { error: { code: "anchor_version_invalid", message: "phiên bản neo không hợp lệ" } };

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
  assert.deepEqual(xlsx[0], { type: "control", req: { cmd: "goto", target: { kind: "range", sheet: "Doanh thu Q2", range: "A7" } } });
  assert.equal(xlsx[1].type, "click");
  assert.match("Insert row", new RegExp(xlsx[1].name));
  assert.match("Chèn hàng", new RegExp(xlsx[1].name));
  assert.ok(Array.isArray(EDIT_DRIVERS.pdf.prepare), "pdf needs pages before it can move or lose one");
});

// ---- the flow against the fake -------------------------------------------------

function fakeCtx(fake, fixture) {
  const steps = {};
  return {
    row: "G8-A02",
    fixture,
    runDir: mkdtempSync(join(tmpdir(), "g819-a02-")),
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

/** Scripts a server that moves the anchor on the first Save after the shift and loses it after the remove. */
function scriptXlsxServer(fake) {
  const state = { head: "ver-1", anchor: null, anchorState: null, anchorVersion: null, saves: 0, comment: null };
  fake.script.respond("api.mintLaunch", { status: 201, body: { launch_url: "uniwork-office-dev://open?ticket=t1" } });
  fake.script.respond("app.openByTicket", (call) => ({ path: "/wc/doc.xlsx", documentId: call.args[1]?.documentId ?? "doc-1", kind: "sheets" }));
  fake.script.respond("app.comments.context", () => ({ ok: true, value: { documentId: "doc-1", versionId: state.head } }));
  fake.script.respond("app.comments.create", (call) => {
    const input = call.args[0];
    if (input.parentId) return { ok: true, value: { comment: { id: "r1", parent_id: input.parentId } } };
    state.anchor = input.anchor;
    state.anchorState = "exact";
    state.anchorVersion = input.baseVersionId;
    state.comment = { id: "c1", body: input.body };
    return { ok: true, value: { comment: { id: "c1", anchor: input.anchor, anchor_state: "exact", anchor_version_id: input.baseVersionId } } };
  });
  fake.script.respond("app.evalBounded", () => ({ status: "ok" }));
  fake.script.respond("app.save", () => {
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
  fake.script.respond("api.getDocument", () => ({ status: 200, body: { document: { id: "doc-1", file: { version_id: state.head } } } }));
  fake.script.respond("api.listDocumentComments", () => ({
    status: 200,
    body: {
      comments: [
        { id: "c1", body: state.comment?.body, anchor: state.anchor, anchor_state: state.anchorState, anchor_version_id: state.anchorVersion, deleted_at: null, parent_id: null },
        { id: "r1", parent_id: "c1", body: "reply", deleted_at: null },
      ],
      list_token: `lt-${state.saves}`,
    },
  }));
  fake.script.respond("api.putDocumentCommentAnchors", { status: 400, body: bodyInvalid });
  return state;
}

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

  const created = fake.calls.app.find((c) => c.key === "comments.create" && !c.args[0].parentId);
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
