// G8-19 (UNI-1414) row module G8-A02 "anchors survive Save", plus the anchor
// and desktop helpers comments.mjs shares:
//   node scripts/office/g5g6g7/g8-19/anchors.mjs --row G8-A02 --fixture <fx> --run-dir <dir>
// Desktop user A comments on an anchor of the fixture, makes a structural edit
// in the editor that moves it, saves, and the server row must follow to the new
// head version (exact); a second edit removes the target and the row goes lost
// with its thread kept; three PUT anchors calls with a version that is not the
// document's answer the same 400. The web -> desktop direction needs the web
// frame to carry the G8-12..15 adapters: BLOCKED(R1) while the pin is older.
// Contract: scripts/office/g5g6g7/harness/g8-contract.md; plan card G8-19.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { connectApp as realConnectApp, editorKindOfFormat } from "../harness/app.mjs";
import { sleep as realSleep } from "../harness/app-steps.mjs";
import { loadVerifiedFixture } from "../harness/fixture-files.mjs";
import { DEV_CLIENT_ID, forkCacheDir, isMainModule } from "../harness/lib.mjs";
import { readZipParts } from "./file-scan.mjs";
import { B7_ANCHOR, B7_SHEET_NAME, WEB_FRAME_PIN_OWNER, decideFromSteps, rowMain } from "./run-row.mjs";

/** The four editor fixtures of G8-A01/A02 and the anchor format each carries. */
export const FIXTURE_FORMAT = Object.freeze({
  "fx-docx-report-vi": "docx",
  "fx-xlsx-revenue-xyz": "xlsx",
  "fx-pptx-deck-vi": "pptx",
  "fx-pdf-invoice-vi": "pdf",
});

// ---- R1: the web frame pin ------------------------------------------------------

const PIN_FILE = Object.freeze({ docx: "docs.pin.json", xlsx: "sheets.pin.json", pptx: "slides.pin.json", pdf: "pdf.pin.json" });
const PIN_DIR = "apps/web/platform/office-frame";
/** Frame builds known to predate the fork editor cards (the web pin today, and the G5-G7 base). */
const PRE_G8_EDITOR_PINS = Object.freeze(["05fd209", "0d03b18"]);
/** Fork commits of G8-12+13 (docx/xlsx), G8-14 (pptx) and G8-15 (pdf) a frame must contain. */
export const G8_EDITOR_COMMITS = Object.freeze(["e2dc03bbf", "f9a5a7742", "b6f152ef0"]);

/** The web frame pin of the editor that opens `format`, read now: `{ file, gitSha, version }` or null. */
export function readFramePin(repoRoot, format) {
  const name = PIN_FILE[format];
  if (!name) return null;
  const file = join(PIN_DIR, name);
  const abs = join(repoRoot, file);
  if (!existsSync(abs)) return null;
  const pin = JSON.parse(readFileSync(abs, "utf8"));
  return { file, gitSha: String(pin.gitSha ?? ""), version: String(pin.version ?? "") };
}

/**
 * BLOCKED(R1) while the pinned web frame lacks the G8-12..15 anchor adapters,
 * else null. `isAncestor(commit, sha)` answers true/false from a fork clone, or
 * null when it cannot tell; without an answer only the known pre-G8 pins block,
 * so a newer pin runs the real check (which FAILs if the frame still lacks them).
 */
export function framePinBlock(pin, { isAncestor = null } = {}) {
  const block = (sha, why) => ({ status: "BLOCKED", blocker: `web frame ${why} lacks G8-12..15 (R1)`, owner: WEB_FRAME_PIN_OWNER, pin: sha });
  const sha = String(pin?.gitSha ?? "");
  if (!sha) return block("", "has no pin for this editor and so");
  if (PRE_G8_EDITOR_PINS.some((old) => old.startsWith(sha) || sha.startsWith(old))) return block(sha, `pin ${sha}`);
  if (typeof isAncestor === "function") {
    const answers = G8_EDITOR_COMMITS.map((commit) => isAncestor(commit, sha));
    if (answers.includes(false)) return block(sha, `pin ${sha}`);
  }
  return null;
}

/** isAncestor() over the fork clone start.sh made (OFFICE_FORK_CACHE), or null when there is none. */
export function forkAncestorChecker(env = process.env, portsEnv = {}) {
  const sha = env.OFFICE_FORK_SHA || portsEnv.OFFICE_FORK_SHA || "";
  const dir = env.OFFICE_FORK_DIR || (sha ? forkCacheDir(env.OFFICE_FORK_CACHE || join(homedir(), ".cache", "uniwork-office-harness"), sha) : "");
  if (!dir || !existsSync(join(dir, ".git"))) return null;
  return (commit, target) => {
    const res = spawnSync("git", ["-C", dir, "merge-base", "--is-ancestor", commit, target], { encoding: "utf8", timeout: 10_000 });
    if (res.status === 0) return true;
    if (res.status === 1) return false;
    return null;
  };
}

// ---- anchors per fixture (fork 7d665a54 codecs) --------------------------------------

/** Top-level body blocks of a docx (w:p, w:tbl, w:sdt) and their text. */
function docxBlocks(bytes) {
  const part = readZipParts(bytes).find((p) => p.name === "word/document.xml");
  if (!part) throw new Error("docx fixture has no word/document.xml");
  const xml = part.data.toString("utf8");
  const body = xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("</w:body>"));
  const blocks = body.match(/<w:(p|tbl|sdt)\b[\s\S]*?<\/w:\1>/g) ?? [];
  return blocks.map((b) => [...b.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
}

const DOCX_BLOCK = 2;
const DOCX_QUOTE_CP = 20;
const PDF_ANCHOR_PAGE = 2;

/**
 * The anchor desktop A writes on `fixtureId` before any edit:
 * - xlsx `B7_ANCHOR` (sheet-2 = "Doanh thu Q2", fork apps/sheets/src/renderer/server-comments/anchor-store.ts:36-41,86-88);
 * - docx block 2 (the first body paragraph), path/start/end/quote/prefix/suffix
 *   (fork apps/docs/src/renderer/server-comments/anchor-codec.ts:26-36,97-120);
 * - pptx the second slide by its p:sldId (fork apps/slides/src/renderer/server-comments.ts:37-50,67-81);
 * - pdf page 2 of the deck the pdf prepare plan builds (fork apps/pdf/src/renderer/server-comments/pdf-anchor.ts:23-50).
 */
export function anchorForFixture(fixtureId, { repoRoot, bytes = null } = {}) {
  const format = FIXTURE_FORMAT[fixtureId];
  const read = () => bytes ?? loadVerifiedFixture(fixtureId, repoRoot).bytes;
  if (format === "xlsx") return { ...B7_ANCHOR };
  if (format === "docx") {
    const text = docxBlocks(read())[DOCX_BLOCK] ?? "";
    const cps = [...text];
    const quote = cps.slice(0, DOCX_QUOTE_CP).join("");
    if (!quote) throw new Error(`docx fixture block ${DOCX_BLOCK} has no text`);
    return { format: "docx", v: 1, path: [DOCX_BLOCK], start: 0, end: quote.length, quote, prefix: "", suffix: cps.slice(DOCX_QUOTE_CP, DOCX_QUOTE_CP + 64).join("") };
  }
  if (format === "pptx") {
    const part = readZipParts(read()).find((p) => p.name === "ppt/presentation.xml");
    const ids = [...(part?.data.toString("utf8") ?? "").matchAll(/<p:sldId\s[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
    if (ids.length < 2) throw new Error("pptx fixture needs two slides");
    return { format: "pptx", v: 1, slide_id: ids[1], slide_index: 1 };
  }
  if (format === "pdf") return { format: "pdf", v: 1, page: PDF_ANCHOR_PAGE, rect: [72, 700, 96, 724] };
  throw new Error(`no anchor plan for fixture ${fixtureId}`);
}

const shiftRows = (range, by) => String(range).toUpperCase().replace(/([A-Z]+)(\d+)/g, (_, col, row) => `${col}${Number(row) + by}`);

/** Where the anchor must sit after the EDIT_DRIVERS shift plan and a Save. */
export function expectedAfterShift(anchor) {
  switch (anchor?.format) {
    case "xlsx":
      return { ...anchor, range: shiftRows(anchor.range, 1) };
    case "docx":
      return { ...anchor, path: [anchor.path[0] + 1, ...anchor.path.slice(1)] };
    case "pptx":
      return { ...anchor, slide_index: anchor.slide_index + 1 };
    case "pdf":
      return { ...anchor, page: anchor.page - 1 };
    default:
      throw new Error(`no shift rule for anchor format ${anchor?.format}`);
  }
}

/** Whether `actual` names the place `expected` names (the fields the codec locates by). */
export function anchorMatches(expected, actual) {
  if (!expected || !actual || expected.format !== actual.format) return false;
  switch (expected.format) {
    case "xlsx":
      return expected.sheet === actual.sheet && String(expected.range).toUpperCase() === String(actual.range).toUpperCase();
    case "docx":
      return JSON.stringify(expected.path) === JSON.stringify(actual.path) && expected.quote === actual.quote;
    case "pptx":
      return expected.slide_id === actual.slide_id && expected.slide_index === actual.slide_index;
    case "pdf":
      return expected.page === actual.page && Array.isArray(actual.rect) && expected.rect.every((n, i) => Math.abs(n - actual.rect[i]) <= 0.01);
    default:
      return false;
  }
}

function describeAnchor(a) {
  if (!a) return "none";
  if (a.format === "xlsx") return `${a.sheet}!${a.range}`;
  if (a.format === "docx") return `path ${JSON.stringify(a.path)}`;
  if (a.format === "pptx") return `slide ${a.slide_id} at ${a.slide_index}`;
  if (a.format === "pdf") return `page ${a.page}`;
  return JSON.stringify(a);
}

// ---- structural edits in the desktop editors (lead decision: own EDIT_DRIVERS) ----

/**
 * One page action, evaluated IN the editor page through ctrl.evalBounded
 * (self-contained: Playwright serializes it). `control` calls the editor's
 * `window.__genofficeControl`; `click`/`focus` find a product control by CSS
 * selector and an accessible-name regex; `key` dispatches keydown/keyup to a
 * target (the editors' own keymaps handle it). Resolves `{status:"ok"|"error"}`.
 */
export async function pageAction(a) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const labelOf = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  if (a.type === "control") {
    for (let i = 0; i < 40; i += 1) {
      const fn = window.__genofficeControl;
      const reply = typeof fn === "function" ? await fn(a.req) : null;
      if (reply && reply.status !== "not_ready") return reply.status === "ok" ? { status: "ok", result: reply.result } : { status: "error", reason: JSON.stringify(reply.error ?? reply) };
      await wait(250);
    }
    return { status: "error", reason: "__genofficeControl stayed not_ready" };
  }
  if (a.type === "click" || a.type === "focus") {
    const re = a.name ? new RegExp(a.name, "i") : null;
    let el = null;
    for (let i = 0; i < 20 && !el; i += 1) {
      el = [...document.querySelectorAll(a.selector || "button")].find((node) => !re || re.test(labelOf(node))) ?? null;
      if (!el) await wait(250);
    }
    if (!el) return { status: "error", reason: `no element ${a.selector || "button"}${a.name ? ` named /${a.name}/` : ""}` };
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return { status: "error", reason: `${labelOf(el) || a.selector} is disabled` };
    if (a.type === "click") el.click();
    else el.focus();
    await wait(a.settleMs ?? 300);
    return { status: "ok", label: labelOf(el).slice(0, 80) };
  }
  if (a.type === "key") {
    const target = a.target ? document.querySelector(a.target) : document.activeElement || document.body;
    if (!target) return { status: "error", reason: `no ${a.target}` };
    const init = { key: a.key, code: a.code ?? a.key, ctrlKey: Boolean(a.ctrl), shiftKey: Boolean(a.shift), metaKey: Boolean(a.meta), bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    await wait(a.settleMs ?? 300);
    return { status: "ok" };
  }
  return { status: "error", reason: `unknown page action ${a.type}` };
}

const goto = (target) => ({ type: "control", req: { cmd: "goto", target } });
const pdfPagesTab = { type: "click", selector: ".ribbon-tab", name: "^(Pages|Trang)$" };

/**
 * Per format: the product commands that move the anchored target (`shift`) and
 * remove it (`remove`), plus `prepare` for pdf (the one-page invoice needs
 * pages before one can move or go). Each plan only uses commands the editor
 * offers a user; `cites` are the fork 7d665a54 lines they rely on. Exported so
 * T1 can lift it into harness/app.mjs.
 */
export const EDIT_DRIVERS = Object.freeze({
  xlsx: {
    // select A7 of "Doanh thu Q2", Home > Insert row (above): B7 -> B8; then Delete row on 8: lost
    shift: [goto({ kind: "range", sheet: B7_SHEET_NAME, range: "A7" }), { type: "click", selector: "button[aria-label]", name: "^(Insert row|Chèn hàng)$" }],
    remove: [goto({ kind: "range", sheet: B7_SHEET_NAME, range: "A8" }), { type: "click", selector: "button[aria-label]", name: "^(Delete row|Xóa hàng)$" }],
    cites: [
      "apps/sheets/src/renderer/control.ts:4-5,63-90 (goto activates the range)",
      "apps/sheets/src/renderer/ExcelShell.tsx:3985-3995 (Insert row / Delete row buttons, insert-row-here / delete-row-here)",
      "apps/sheets/src/renderer/i18n/app/en.ts:1336,1344 (en labels; vi Chèn hàng / Xóa hàng)",
      "apps/sheets/src/renderer/server-comments/anchor-store.ts:102-120 (an insert above shifts the range, a delete loses it)",
    ],
  },
  docx: {
    // goto selects the whole title block; Enter splits it: every later block moves down one (path [2] -> [3])
    shift: [goto({ kind: "block", block: 0 }), { type: "key", key: "Enter", target: ".ProseMirror" }],
    // goto selects the anchored paragraph's text; Backspace deletes it: the quote is gone -> lost
    remove: [goto({ kind: "block", block: DOCX_BLOCK + 1 }), { type: "key", key: "Backspace", target: ".ProseMirror" }],
    cites: [
      "apps/docs/src/renderer/control.ts:6,50 (goto -> navigateToBlock)",
      "apps/docs/src/renderer/ai/doc-nav.ts:19-31 (navigateToBlock selects the textblock and focuses the view)",
      "apps/docs/src/renderer/server-comments/anchor-codec.ts:12-14 (locate by path + quote, else lost)",
    ],
  },
  pptx: {
    // current = slide 0, Ctrl+M adds a blank slide after it: the anchored slide moves 1 -> 2, same slide_id
    shift: [goto({ kind: "slide", slide: 0 }), { type: "key", key: "m", code: "KeyM", ctrl: true, target: "body", settleMs: 800 }],
    // select the anchored slide's thumbnail, focus the rail, Delete removes it -> lost
    remove: [
      { type: "click", selector: '.slide-list [role="option"][data-index="2"]' },
      { type: "focus", selector: ".slide-list" },
      { type: "key", key: "Delete", target: ".slide-list", settleMs: 800 },
    ],
    cites: [
      "apps/slides/src/renderer/control.ts:63-95 (goto slide, 0-based)",
      "apps/slides/src/renderer/keyboard-actions.ts:121-133 (Ctrl+M adds a slide), :373-391 (Delete on the focused rail deletes the selected slides)",
      "apps/slides/src/renderer/App.tsx:3973-3995 (.slide-list thumbnails with data-index), :2645 (window keydown listener)",
      "apps/slides/src/renderer/server-comments.ts:5-7 (slide_id survives a reorder, a deleted slide is lost)",
    ],
  },
  pdf: {
    // Pages > Insert blank page twice after page 1 (3 pages), Saved before the comment is made on page 2
    prepare: [
      goto({ kind: "page", page: 1 }),
      pdfPagesTab,
      { type: "click", selector: "button.rb-big", name: "(Insert blank page|Chèn trang trắng)$", settleMs: 1500 },
      goto({ kind: "page", page: 1 }),
      pdfPagesTab,
      { type: "click", selector: "button.rb-big", name: "(Insert blank page|Chèn trang trắng)$", settleMs: 1500 },
    ],
    // delete page 1: the anchored page 2 becomes page 1 (pageMap at Save); delete it too: lost
    shift: [goto({ kind: "page", page: 1 }), pdfPagesTab, { type: "click", selector: "button.rb-big", name: "(Delete page|Xóa trang)$", settleMs: 800 }],
    remove: [goto({ kind: "page", page: 1 }), pdfPagesTab, { type: "click", selector: "button.rb-big", name: "(Delete page|Xóa trang)$", settleMs: 800 }],
    cites: [
      "apps/pdf/src/renderer/control.ts:3,27-38 (goto page, 1-based)",
      "apps/pdf/src/renderer/App.tsx:327-333 (ribbon tab page), :7395-7404 (Delete page), :7429-7437 (Insert blank page), :4136-4143 (deletePage needs > 1 page)",
      "apps/pdf/src/renderer/App.tsx:3837-3857 (Save hands pageMap to the server comments), server-comments/pdf-anchor.ts:85-105 (remap, missing page -> lost)",
      "apps/pdf/src/renderer/i18n/strings.ts:567,577,580 (en), :925,935,938 (vi)",
    ],
  },
});

/** Runs one plan through ctrl.evalBounded; the first action that is not ok stops it. */
export async function runEditPlan(ctrl, page, actions) {
  for (const [i, action] of actions.entries()) {
    const res = await ctrl.evalBounded(page, pageAction, action, `edit:${action.type}:${i}`);
    if (res?.status !== "ok") return { status: "error", at: i, reason: res?.reason ?? `page action ${i} (${action.type}) answered nothing` };
  }
  return { status: "ok" };
}

// ---- desktop + server helpers shared with comments.mjs ---------------------------

/** The value of a CommentsReply envelope (fork comments-ipc.ts:145), or a thrown error naming the call. */
export function unwrap(reply, call) {
  if (reply?.ok === true) return reply.value;
  const e = reply?.error;
  throw new Error(`${call} -> ${e ? `${e.code ?? "error"}${e.message ? ` (${e.message})` : ""}` : "no reply envelope"}`);
}

/** `fn()` until `pred(value)` or about `boundMs`; resolves `{ value, ok, elapsedMs }` (never unbounded). */
export async function pollUntil(fn, pred, { boundMs = 60_000, intervalMs = 1_000, sleep = realSleep, now = Date.now } = {}) {
  const started = now();
  const maxTries = Math.max(1, Math.ceil(boundMs / intervalMs) + 1);
  let value;
  for (let i = 0; i < maxTries; i += 1) {
    value = await fn();
    if (pred(value)) return { value, ok: true, elapsedMs: now() - started };
    if (now() - started >= boundMs) break;
    await sleep(intervalMs);
  }
  return { value, ok: false, elapsedMs: now() - started };
}

/**
 * Connects to the app, signs `userKey` in, mints a launch ticket for the
 * document (with `commentId` when given) and opens it; resolves
 * `{ ctrl, path, kind, page, comments }`. Closes the CDP link if anything after the connect fails.
 */
export async function openOnDesktop({ ctx, world, connectApp = realConnectApp, userKey = "A", documentId, format, commentId = null }) {
  const ctrl = await connectApp({ portsEnv: ctx.portsEnv, runDir: ctx.runDir, repoRoot: ctx.repoRoot });
  try {
    const signed = await ctrl.signIn(world.user(userKey));
    const state = signed?.status?.state;
    if (state !== "signed-in" && signed?.status?.loggedIn !== true) throw new Error(`desktop sign-in as ${userKey} ended in state ${state ?? "unknown"}`);
    const launch = await world.session(userKey).call(
      "mintLaunch",
      { documentID: documentId },
      { operation: "edit", deployment_id: ctx.portsEnv?.HARNESS_DEPLOYMENT_ID || "default", client_id: DEV_CLIENT_ID, return_hint: "office", ...(commentId ? { comment_id: commentId } : {}) },
    );
    if (!launch.ok || !launch.body?.launch_url) throw new Error(`mintLaunch answered ${launch.status}${launch.error ? ` (${launch.error})` : ""}`);
    const opened = await ctrl.openByTicket(launch.body.launch_url, { documentId });
    const kind = opened.kind ?? editorKindOfFormat(format);
    const page = await ctrl.editorPage(kind);
    return { ctrl, path: opened.path, kind, page, comments: ctrl.comments(page) };
  } catch (err) {
    await Promise.resolve(ctrl.close?.()).catch(() => {});
    throw err;
  }
}

/** GET the comment list (as `session`) and the document head version; throws on a non-2xx. */
export async function readServer(session, documentId) {
  const list = await session.call("listDocumentComments", { documentID: documentId });
  if (!list.ok) throw new Error(`listDocumentComments answered ${list.status}`);
  const doc = await session.call("getDocument", { documentID: documentId });
  if (!doc.ok) throw new Error(`getDocument answered ${doc.status}`);
  return { comments: list.body?.comments ?? [], listToken: list.body?.list_token ?? null, head: doc.body?.document?.file?.version_id ?? null };
}

const rowState = (row) => (row ? { id: row.id, anchor: row.anchor ?? null, anchor_state: row.anchor_state ?? null, anchor_version_id: row.anchor_version_id ?? null, deleted_at: row.deleted_at ?? null } : null);

// ---- G8-A02 decision ----------------------------------------------------------------------

function check(reasons) {
  return reasons.length === 0 ? { status: "PASS" } : { status: "FAIL", reason: reasons.join("; ") };
}

function decideEdit(name, part, more) {
  if (!part) return { status: "FAIL", reason: `${name} did not run` };
  if (part.status === "BLOCKED" || part.status === "FAIL") return { status: part.status, reason: part.reason ?? "", blocker: part.blocker ?? "", owner: part.owner ?? "" };
  const reasons = [];
  if (part.edited?.status !== "ok") reasons.push(`edit driver: ${part.edited?.reason ?? "did not run"}`);
  if (!part.saved) reasons.push("Save failed");
  if (reasons.length === 0) reasons.push(...more(part));
  return check(reasons);
}

/**
 * G8-A02 from the record the flow builds (pure). Checks: create, shift (B8 /
 * path+1 / slide+1 / page-1, exact, on the new head), rest-sees-moved, remove
 * (lost, thread + reply kept, last anchor kept), invalid-versions (three
 * byte-equal 400 anchor_version_invalid, nothing written) and web-to-desktop
 * (BLOCKED(R1) while the frame pin is old). FAIL beats BLOCKED beats PASS.
 */
export function decideG8A02(rec) {
  const steps = {};
  const c = rec.created ?? {};
  steps["check:create"] = check([
    ...(c.ok && c.commentId ? [] : ["the desktop create did not return a comment"]),
    ...(c.anchor?.format === rec.format ? [] : [`anchor format ${c.anchor?.format}, want ${rec.format}`]),
  ]);

  steps["check:shift"] = decideEdit("shift", rec.shift, (s) => {
    const reasons = [];
    const row = s.row;
    if (!row) return ["the comment row is missing after Save"];
    if (!s.headVersionId || s.headVersionId === s.versionBefore) reasons.push(`Save made no new version (head ${s.headVersionId ?? "none"})`);
    if (row.anchor_version_id !== s.headVersionId) reasons.push(`anchor stayed on version ${row.anchor_version_id}, head is ${s.headVersionId}`);
    if (row.anchor_state !== "exact") reasons.push(`anchor_state ${row.anchor_state}, want exact`);
    if (!anchorMatches(s.expected, row.anchor)) reasons.push(`anchor at ${describeAnchor(row.anchor)}, want ${describeAnchor(s.expected)}`);
    return reasons;
  });

  if (rec.shift?.status === "BLOCKED") steps["check:rest-sees-moved"] = { ...steps["check:shift"] };
  else {
    const seen = rec.restSeesMoved;
    const want = rec.shift?.row;
    steps["check:rest-sees-moved"] = check(
      !seen || !want
        ? ["the second reader saw no moved anchor"]
        : [
            ...(anchorMatches(want.anchor, seen.anchor) ? [] : [`B reads ${describeAnchor(seen.anchor)}, desktop saved ${describeAnchor(want.anchor)}`]),
            ...(seen.anchor_version_id === want.anchor_version_id ? [] : [`B reads version ${seen.anchor_version_id}`]),
          ],
    );
  }

  steps["check:remove-lost"] = decideEdit("remove", rec.remove, (r) => {
    const row = r.row;
    if (!row) return ["the thread is gone after the target was deleted (it must stay)"];
    const reasons = [];
    if (row.deleted_at) reasons.push("the thread was deleted with its target");
    if (row.anchor_state !== "lost") reasons.push(`anchor_state ${row.anchor_state}, want lost`);
    if (!(r.replies >= 1)) reasons.push("the reply did not survive");
    const kept = rec.shift?.row?.anchor_version_id;
    if (kept && row.anchor_version_id !== kept) reasons.push(`a lost anchor must keep its last version ${kept}, got ${row.anchor_version_id}`);
    return reasons;
  });

  const inv = Array.isArray(rec.invalidVersions) ? rec.invalidVersions : [];
  const invReasons = [];
  const cases = inv.map((x) => x.case).sort();
  if (JSON.stringify(cases) !== JSON.stringify(["empty", "foreign", "unknown"])) invReasons.push(`cases ${cases.join(",") || "none"}, want empty, foreign, unknown`);
  for (const x of inv) {
    if (x.status !== 400 || x.body?.error?.code !== "anchor_version_invalid") invReasons.push(`${x.case} answered ${x.status} ${x.body?.error?.code ?? ""}`.trim());
  }
  if (new Set(inv.map((x) => JSON.stringify(x.body))).size > 1) invReasons.push("the 400 bodies are not byte-equal");
  const before = rec.remove?.row;
  const after = rec.afterInvalid;
  if (before && after && (after.anchor_state !== before.anchor_state || after.anchor_version_id !== before.anchor_version_id || JSON.stringify(after.anchor) !== JSON.stringify(before.anchor))) {
    invReasons.push("a refused version was written to the row");
  }
  steps["check:invalid-versions"] = check(invReasons);

  const w = rec.webToDesktop ?? { status: "FAIL", reason: "the web -> desktop direction did not run" };
  steps["check:web-to-desktop"] = { status: w.status, ...(w.reason ? { reason: w.reason } : {}), ...(w.blocker ? { blocker: w.blocker, owner: w.owner ?? "" } : {}) };

  return { ...decideFromSteps(steps), steps };
}

/** Why the web -> desktop direction fails once R1 no longer blocks it. */
export const NO_WEB_SAVE_DRIVER = "the web frame pin carries G8-12..15 but harness/web.mjs has no web-frame Save driver (g8-contract.md §6)";

// ---- G8-A02 flow ---------------------------------------------------------------------------

/** Saves `path` through the app; a reply that says it did not save throws. */
export async function saveOnDesktop(ctrl, path) {
  const res = await ctrl.save(path);
  if (res && (res.ok === false || res.error)) throw new Error(`uniworkSave: ${res.error?.code ?? res.error ?? "not saved"}`);
  return res;
}

/**
 * Runs G8-A02 on one fixture (ctx from runRowModule). `deps`: `connectApp`,
 * `sleep`, `now`, `framePin` (else read now), `isAncestor` (else the fork clone).
 */
export async function runG8A02(ctx, deps = {}) {
  const { connectApp = realConnectApp, sleep = realSleep, now = Date.now } = deps;
  const format = FIXTURE_FORMAT[ctx.fixture];
  if (!format) return { status: "FAIL", reason: `G8-A02 has no anchor plan for fixture ${ctx.fixture}` };
  const driver = EDIT_DRIVERS[format];
  const rec = { format, fixture: ctx.fixture, cites: driver.cites, reveal: { covered_by: "G8-A07 deeplink module (T3, desktop reveal B7) + fork vitest G8-12..15 (reveal per format)" } };
  const out = (extra) => ({ ...extra, details: rec });
  const failed = (name, s) => out({ status: "FAIL", reason: `${name}: ${s.reason ?? s.status}` });
  const poll = (fn, pred) => pollUntil(fn, pred, { boundMs: 60_000, intervalMs: 1_000, sleep, now });
  let desk = null;
  try {
    const world = await ctx.getWorld();
    const A = world.session("A");
    const B = world.session("B");
    let doc;
    let other;
    let s = await ctx.step("upload", async () => {
      doc = await world.upload("A", "W2", ctx.fixture, { title: `G8-A02 ${ctx.fixture}` });
      other = await world.upload("A", "W2", ctx.fixture, { title: `G8-A02 foreign ${ctx.fixture}` });
      rec.documentId = doc.documentId;
    });
    if (s.status !== "PASS") return failed("upload", s);

    s = await ctx.step("open-desktop", async () => {
      desk = await openOnDesktop({ ctx, world, connectApp, documentId: doc.documentId, format });
    });
    if (s.status !== "PASS") return failed("open-desktop", s);

    if (driver.prepare) {
      s = await ctx.step("prepare", async () => {
        const edited = await runEditPlan(desk.ctrl, desk.page, driver.prepare);
        if (edited.status !== "ok") throw new Error(`prepare edit: ${edited.reason}`);
        await saveOnDesktop(desk.ctrl, desk.path);
      });
      if (s.status !== "PASS") return failed("prepare", s);
    }

    s = await ctx.step("create", async () => {
      const context = unwrap(await desk.comments.context({ path: desk.path }), "comments.context");
      const anchor = anchorForFixture(ctx.fixture, { repoRoot: ctx.repoRoot });
      const root = unwrap(
        await desk.comments.create({ path: desk.path, kind: "comment", body: `G8-A02 ${ctx.fixture} anchored`, anchor, baseVersionId: context.versionId }),
        "comments.create",
      ).comment;
      const reply = unwrap(await desk.comments.create({ path: desk.path, kind: "comment", parentId: root.id, body: "G8-A02 reply" }), "comments.create(reply)").comment;
      rec.created = { ok: true, commentId: root.id, anchor, versionId: context.versionId, replyId: reply?.id ?? null };
    });
    if (s.status !== "PASS") return failed("create", s);
    const commentId = rec.created.commentId;
    const rowOf = (server) => server.comments.find((r) => r.id === commentId) ?? null;

    await ctx.step("shift", async () => {
      const versionBefore = (await readServer(A, doc.documentId)).head;
      const expected = expectedAfterShift(rec.created.anchor);
      const edited = await runEditPlan(desk.ctrl, desk.page, driver.shift);
      rec.shift = { edited, saved: false, versionBefore, expected };
      if (edited.status !== "ok") return { status: "FAIL", reason: `edit driver: ${edited.reason}` };
      await saveOnDesktop(desk.ctrl, desk.path);
      rec.shift.saved = true;
      const settled = await poll(
        () => readServer(A, doc.documentId),
        (srv) => {
          const row = rowOf(srv);
          return Boolean(row && srv.head && srv.head !== versionBefore && row.anchor_version_id === srv.head && row.anchor_state === "exact");
        },
      );
      Object.assign(rec.shift, { headVersionId: settled.value.head, row: rowState(rowOf(settled.value)), elapsedMs: settled.elapsedMs });
      return settled.ok ? {} : { status: "FAIL", reason: `the server row did not reach the new version within ${settled.elapsedMs} ms` };
    });

    await ctx.step("rest-sees-moved", async () => {
      const row = rowOf(await readServer(B, doc.documentId));
      rec.restSeesMoved = row ? { anchor: row.anchor, anchor_version_id: row.anchor_version_id } : null;
    });

    await ctx.step("remove", async () => {
      const edited = await runEditPlan(desk.ctrl, desk.page, driver.remove);
      rec.remove = { edited, saved: false };
      if (edited.status !== "ok") return { status: "FAIL", reason: `edit driver: ${edited.reason}` };
      await saveOnDesktop(desk.ctrl, desk.path);
      rec.remove.saved = true;
      const settled = await poll(() => readServer(A, doc.documentId), (srv) => rowOf(srv)?.anchor_state === "lost");
      const replies = settled.value.comments.filter((r) => r.parent_id === commentId && !r.deleted_at).length;
      Object.assign(rec.remove, { headVersionId: settled.value.head, row: rowState(rowOf(settled.value)), replies, elapsedMs: settled.elapsedMs });
      return settled.ok ? {} : { status: "FAIL", reason: `the row did not go lost within ${settled.elapsedMs} ms` };
    });

    await ctx.step("invalid-versions", async () => {
      // a purged version cannot be made through REST (no document/version delete route in
      // server/internal/handler/router/documents.go); the server answers it through the same
      // single lookup as an unknown id (server/internal/service/document_comment_anchors.go:362-369)
      const cases = [
        ["foreign", other.versionId],
        ["unknown", "01J8X4VER0N1P2Q3R4S5T6U7V8"],
        ["empty", ""],
      ];
      rec.invalidVersions = [];
      for (const [name, versionId] of cases) {
        const res = await A.call("putDocumentCommentAnchors", { documentID: doc.documentId }, { version_id: versionId, anchors: [{ comment_id: commentId, anchor: rec.created.anchor, state: "exact" }] });
        rec.invalidVersions.push({ case: name, status: res.status, body: res.body });
      }
      rec.afterInvalid = rowState(rowOf(await readServer(A, doc.documentId)));
    });

    const block = framePinBlock(deps.framePin ?? readFramePin(ctx.repoRoot, format), { isAncestor: deps.isAncestor ?? forkAncestorChecker(process.env, ctx.portsEnv) });
    rec.webToDesktop = block ?? { status: "FAIL", reason: NO_WEB_SAVE_DRIVER };
    return out(decideG8A02(rec));
  } catch (err) {
    return out({ status: "FAIL", reason: err instanceof Error ? err.message : String(err) });
  } finally {
    if (desk?.ctrl) await Promise.resolve(desk.ctrl.close?.()).catch(() => {});
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  const code = await rowMain("anchors", (ctx) =>
    ctx.row === "G8-A02" ? runG8A02(ctx) : { status: "FAIL", reason: `anchors.mjs runs G8-A02 only, not ${ctx.row}` },
  );
  process.exit(code);
}
