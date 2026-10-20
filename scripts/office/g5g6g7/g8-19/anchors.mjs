// G8-19 (UNI-1414) row module G8-A02 "anchors survive Save", plus the anchor
// and desktop helpers comments.mjs shares:
//   node scripts/office/g5g6g7/g8-19/anchors.mjs --row G8-A02 --fixture <fx> --run-dir <dir>
// First, on its own document (check:closed-panel-save): the document is open on the
// desktop with the panel closed, the server log shows the editor's first comment
// list, and only then A comments over REST (the cross-host case); a structural edit
// before it and a Save must move the server anchor to the new head (AC G8-A02,
// contract-collab G8-D2: a map after every Save receipt); left on the old version it
// is a product FAIL, never hidden or BLOCKED, and a run whose comment does not
// postdate that first list FAILs as "scenario not established" (harness).
// Then desktop user A comments on an anchor of the fixture, opens the editor's own
// comments panel and waits until it lists that comment (the post-Save anchor
// round only covers roots the editor has listed), makes a structural edit
// in the editor that moves it, saves, and the server row must follow to the new
// head version (exact); a second edit removes the target and the row goes lost
// with its thread kept; three PUT anchors calls with a version that is not the
// document's answer the same 400. The web -> desktop direction (the same shift
// plan run in the web frame, saved with harness/web.mjs webSave, read on the
// desktop) needs the web frame to carry the G8-12..15 adapters: BLOCKED(R1)
// while the pin is older. Last, check:lost-view-version (UNI-2033): the row the
// remove step left lost names the version it was last anchored on, the web opens
// that version read-only (no Save, no anchors write) and `?comment=` alone follows
// to it once, and a view ticket opens the @vN copy on the desktop.
// Contract: scripts/office/g5g6g7/harness/g8-contract.md; plan card G8-19.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { API_PREFIX } from "../harness/api-contract.mjs";
import { connectApp as realConnectApp, editorKindOfFormat, editorKindOfUrl } from "../harness/app.mjs";
import { loadPlaywrightChromium, sleep as realSleep } from "../harness/app-steps.mjs";
import { loadVerifiedFixture } from "../harness/fixture-files.mjs";
import { DEV_CLIENT_ID, forkCacheDir, harnessPaths, isMainModule } from "../harness/lib.mjs";
import * as realWeb from "../harness/web.mjs";
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
  return { file, gitSha: String(pin.gitSha ?? ""), version: String(pin.version ?? ""), protocolSha: String(pin.protocolSha256?.protocol ?? "") };
}

// ---- the web frame pin vs the fork UNI-2033 kit/protocol (comments.viewVersion, openVersionId) ----

/** Frame builds known to predate fork UNI-2033: the G5-G7 base pins and fork 1abc493e4 (REPIN-6). */
const PRE_VIEW_VERSION_PINS = Object.freeze([...PRE_G8_EDITOR_PINS, "1abc493"]);
/** `protocolSha256.protocol` (sha of web/docs/protocol/types.ts) before and after fork e854a49ae (T4: comments.viewVersion). */
export const PRE_VIEW_VERSION_PROTOCOL_SHAS = Object.freeze(["4e8633643d3bf5e6f14ccb679e39704d0935a362a9b8dfc51bb774f06acfa1c1"]);
export const VIEW_VERSION_PROTOCOL_SHA = "914cc47118663fd7e503d90a9fe57671d7364ab6bbd217d9b927f3d192841664";
/** The fork commit a frame must contain for `comments.viewVersion` / `commentsViewVersion` (T4, web/docs/protocol). */
export const VIEW_VERSION_FORK_COMMITS = Object.freeze(["e854a49ae"]);
export const VIEW_VERSION_BLOCKER = "frame pin predates the fork UNI-2033 kit/protocol (T6 re-pin)";
export const VIEW_VERSION_BLOCKER_OWNER = "g6-fork_ui T6";

/**
 * The web part of check:lost-view-version is BLOCKED while the pinned frame lacks the fork UNI-2033
 * protocol, else null. Decided from facts, never a timeout: the pin's git sha against the known older
 * pins, its `protocolSha256.protocol` against the pre-T4 value (the T4 value lifts it), and, when a
 * fork clone answers, whether the T4 commit is an ancestor of the pin. An unknown newer pin with no
 * answer runs the real check (which FAILs if the frame still lacks the protocol).
 */
export function viewVersionPinBlock(pin, { isAncestor = null } = {}) {
  const sha = String(pin?.gitSha ?? "");
  const block = { status: "BLOCKED", blocker: VIEW_VERSION_BLOCKER, owner: VIEW_VERSION_BLOCKER_OWNER, pin: sha };
  if (!sha) return block;
  const protocol = String(pin?.protocolSha ?? "");
  if (protocol === VIEW_VERSION_PROTOCOL_SHA) return null;
  if (PRE_VIEW_VERSION_PINS.some((old) => old.startsWith(sha) || sha.startsWith(old))) return block;
  if (PRE_VIEW_VERSION_PROTOCOL_SHAS.includes(protocol)) return block;
  if (typeof isAncestor === "function" && VIEW_VERSION_FORK_COMMITS.some((commit) => isAncestor(commit, sha) === false)) return block;
  return null;
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

/** Top-level body blocks of a docx (w:p, w:tbl, w:sdt; an empty `<w:p/>` is one) and their text. */
function docxBlocks(bytes) {
  const part = readZipParts(bytes).find((p) => p.name === "word/document.xml");
  if (!part) throw new Error("docx has no word/document.xml");
  const xml = part.data.toString("utf8");
  const body = xml.slice(xml.indexOf("<w:body>") + 8, xml.lastIndexOf("</w:body>"));
  const blocks = body.match(/<w:(p|tbl|sdt)\b(?:[^>]*\/>|[\s\S]*?<\/w:\1>)/g) ?? [];
  return blocks.map((b) => [...b.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
}

/** The index of the first top-level block of a saved docx whose text holds `quote`, or null. */
export function docxQuoteBlock(bytes, quote) {
  const at = docxBlocks(bytes).findIndex((text) => text.includes(quote));
  return at === -1 ? null : at;
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
 * - pdf page 2 of the deck the pdf prepare plan builds, or `pdfPage` (fork apps/pdf/src/renderer/server-comments/pdf-anchor.ts:23-50).
 */
export function anchorForFixture(fixtureId, { repoRoot, bytes = null, pdfPage = PDF_ANCHOR_PAGE } = {}) {
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
  if (format === "pdf") return { format: "pdf", v: 1, page: pdfPage, rect: [72, 700, 96, 724] };
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
 * selector and an accessible-name regex (`unlessActive`: an element that
 * already carries the `active` class is left alone - a second press on the
 * active ribbon tab collapses the ribbon, fork packages/ui/src/ribbon-collapse.tsx:367);
 * `key` dispatches keydown/keyup to a target (the editors' own keymaps handle
 * it). Resolves `{status:"ok"|"error"}`.
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
    if (a.unlessActive && el.classList?.contains("active")) return { status: "ok", label: labelOf(el).slice(0, 80), skipped: "active" };
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
const ribbonTab = (name) => ({ type: "click", selector: ".ribbon-tab", name, unlessActive: true });
const pdfPagesTab = ribbonTab("^(Pages|Trang)$");
const sheetsHomeTab = ribbonTab("^(Home|Trang đầu)$");
const reviewTab = ribbonTab("^(Review|Xem lại)$");

/**
 * Per editor: the ribbon tab and the control a user presses to show the server
 * comments panel (the editor WebContentsView, not the shell). Opening it makes the
 * editor's own collab controller list the document's comments (comments-poll.ts:118-131
 * polls only while the panel is open); the post-Save anchor round only covers the roots
 * that controller has listed, located once when first listed.
 */
export const PANEL_OPENERS = Object.freeze({
  docx: {
    plan: [reviewTab, { type: "click", selector: "button.rb-big", name: "^(Show Comments|Hiện nhận xét)$", settleMs: 800 }],
    cites: [
      "apps/docs/src/renderer/components/ribbon-tabs.tsx:1029-1039 (Review > Show Comments, rb-big, no aria-label)",
      "apps/docs/src/renderer/components/Ribbon.tsx:2067-2080 (.ribbon-tab buttons), i18n/ribbon/en.ts:14,701 vi.ts:14,699",
      "apps/docs/src/renderer/App.tsx:7581-7588 (ServerCommentsHost panelOpen = showComments)",
      "apps/docs/src/renderer/server-comments/anchor-sync.ts:17-35 (the anchor map covers the listed roots only)",
    ],
  },
  xlsx: {
    // the label follows a glyph span (ToolSymbol): matched at the end only
    plan: [reviewTab, { type: "click", selector: "button.styles-row", name: "(Show Comments|Hiện nhận xét)$", settleMs: 800 }],
    cites: [
      "apps/sheets/src/renderer/ExcelShell.tsx:3415-3422 (Review > Show Comments -> comments-pane-toggle), :979-991 (.ribbon-tab)",
      "apps/sheets/src/renderer/threaded-comment-actions.ts:85-86 (threadPane.toggle), server-comments/CommentsSurface.tsx:64-71 (panelOpen = pane.open)",
      "apps/sheets/src/renderer/i18n/app/en.ts:659,1239 vi.ts:671,1251",
      "apps/sheets/src/renderer/server-comments/SheetsServerComments.tsx:193-195,206-219 (track on list, anchor map on Save)",
    ],
  },
  pptx: {
    plan: [reviewTab, { type: "click", selector: "button.rb-big", name: "^(Comments Pane|Ngăn nhận xét)( \\(\\d+\\))?$", settleMs: 800 }],
    cites: [
      "apps/slides/src/renderer/components/Ribbon.tsx:2545 (review tab), :2626-2639 (Comments Pane + count suffix), :1909-1920 (.ribbon-tab)",
      "apps/slides/src/renderer/App.tsx:3586 (onToggleComments), components/CommentsPane.tsx:329-340 (open = slot shown)",
      "apps/slides/src/renderer/use-server-comments.ts:158-177 (the Save round covers the controller's threads only)",
    ],
  },
  pdf: {
    plan: [ribbonTab("^(Annotate|Chú thích)$"), { type: "click", selector: "#pdf-server-comments-toggle", settleMs: 800 }],
    cites: [
      "apps/pdf/src/renderer/App.tsx:315,7001-7014 (Annotate > #pdf-server-comments-toggle, label collabComments), :327-333 (ribbon tabs), :9765-9776 (open = serverPanelOpen)",
    ],
  },
});

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
    shift: [sheetsHomeTab, goto({ kind: "range", sheet: B7_SHEET_NAME, range: "A7" }), { type: "click", selector: "button[aria-label]", name: "^(Insert row|Chèn hàng)$" }],
    remove: [sheetsHomeTab, goto({ kind: "range", sheet: B7_SHEET_NAME, range: "A8" }), { type: "click", selector: "button[aria-label]", name: "^(Delete row|Xóa hàng)$" }],
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
    return await openTicketOnDesktop({ ctx, world, ctrl, userKey, documentId, format, commentId });
  } catch (err) {
    await Promise.resolve(ctrl.close?.()).catch(() => {});
    throw err;
  }
}

/** Mints a launch ticket for `documentId` as `userKey` and opens it in the already signed-in app. */
export async function openTicketOnDesktop({ ctx, world, ctrl, userKey = "A", documentId, format, commentId = null, operation = "edit", version = null, copyMarker = null, sleep = realSleep, now = Date.now }) {
  const launch = await world.session(userKey).call(
    "mintLaunch",
    { documentID: documentId },
    { operation, ...(version ? { version } : {}), deployment_id: ctx.portsEnv?.HARNESS_DEPLOYMENT_ID || "default", client_id: DEV_CLIENT_ID, return_hint: "office", ...(commentId ? { comment_id: commentId } : {}) },
  );
  if (!launch.ok || !launch.body?.launch_url) throw new Error(`mintLaunch answered ${launch.status}${launch.error ? ` (${launch.error})` : ""}`);
  let opened = await ctrl.openByTicket(launch.body.launch_url, { documentId });
  // a document that is already open answers the ticket with its active working copy at once; a version copy
  // (`...@vN`) is a second copy, so wait (bounded) until the app reports it as the active one
  if (copyMarker && !String(opened.path ?? "").includes(copyMarker)) {
    const seen = await pollUntil(() => Promise.resolve(ctrl.aiOffice("uniworkActiveDocStatus")).catch(() => null), (st) => String(st?.path ?? "").includes(copyMarker) && (!documentId || st.documentId === documentId), { boundMs: 20_000, intervalMs: 500, sleep, now });
    if (!seen.ok) throw new Error(`the app opened no ${copyMarker} copy of the document (active copy: ${seen.value?.path ?? "none"})`);
    opened = { ...opened, path: seen.value.path };
  }
  const kind = opened.kind ?? editorKindOfFormat(format);
  // the page that shows THIS document: another one of the same kind may be open (harness contract §15)
  const page = await ctrl.editorPage(kind, { path: opened.path, documentId });
  return { ctrl, path: opened.path, kind, page, comments: ctrl.comments(page) };
}

/** GET the bytes of version `version` of a file document as the bearer of `token` (router/documents.go:198, ?version=N). */
export async function downloadVersion({ apiOrigin, token, documentId, version, fetchImpl = fetch, timeoutMs = 60_000 }) {
  const url = `${apiOrigin}${API_PREFIX}/documents/${encodeURIComponent(documentId)}/download?version=${encodeURIComponent(String(version))}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`download of version ${version} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** GET the comment list (as `session`) and the document head version; throws on a non-2xx. */
export async function readServer(session, documentId) {
  const list = await session.call("listDocumentComments", { documentID: documentId });
  if (!list.ok) throw new Error(`listDocumentComments answered ${list.status}`);
  const doc = await session.call("getDocument", { documentID: documentId });
  if (!doc.ok) throw new Error(`getDocument answered ${doc.status}`);
  const file = doc.body?.document?.file ?? {};
  return { comments: list.body?.comments ?? [], listToken: list.body?.list_token ?? null, head: file.version_id ?? null, headVersion: file.version ?? null };
}

/** The head version of a document (getDocument only: no comment list, so it never reads as an editor's list in server.log). */
async function readHead(session, documentId) {
  const doc = await session.call("getDocument", { documentID: documentId });
  if (!doc.ok) throw new Error(`getDocument answered ${doc.status}`);
  return doc.body?.document?.file?.version_id ?? null;
}

const ANSI = /\x1b\[[0-9;]*m/g;

/** Byte size of the harness server log (0 when it does not exist): the offset a later read starts from. */
export function logSize(path) {
  return path && existsSync(path) ? statSync(path).size : 0;
}

/**
 * The comment-list requests of `documentId` the server logged after `offset` bytes
 * (server/internal/middleware/request_logger.go: method, path, status; tint text or LOG_FORMAT=json);
 * `[{status, time}]`, or null when there is no log.
 */
export function documentListRequests(serverLogPath, offset, documentId) {
  if (!serverLogPath || !existsSync(serverLogPath)) return null;
  const want = `${API_PREFIX}/documents/${documentId}/comments`;
  const out = [];
  for (const raw of readFileSync(serverLogPath).subarray(offset).toString("utf8").split("\n")) {
    const line = raw.replace(ANSI, "").trim();
    if (!line.includes(want)) continue;
    let f;
    if (line.startsWith("{")) {
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
    } else {
      f = { method: /\bmethod=(\S+)/.exec(line)?.[1], path: /\bpath=(\S+)/.exec(line)?.[1], status: /\bstatus=(\d+)/.exec(line)?.[1], time: /^(\S+)\s/.exec(line)?.[1] };
    }
    if (f.method === "GET" && f.path === want) out.push({ status: Number(f.status), time: f.time ?? null });
  }
  return out;
}

/**
 * The writes of a version view the server logged after `offset` bytes: a Save commit or a comments.anchors
 * PUT of `documentId` (the frame's own commit route included); `["POST /path", ...]`, or null when there is no log.
 * Other posts of the page (the frame token, the launch ticket) are not writes of the document.
 */
export function documentWriteRequests(serverLogPath, offset, documentId) {
  if (!serverLogPath || !existsSync(serverLogPath)) return null;
  const write = new RegExp(`/documents/${documentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(versions/commit|comments/anchors)$`);
  const out = [];
  for (const raw of readFileSync(serverLogPath).subarray(offset).toString("utf8").split("\n")) {
    const line = raw.replace(ANSI, "").trim();
    if (!line) continue;
    let f;
    if (line.startsWith("{")) {
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
    } else {
      f = { method: /\bmethod=(\S+)/.exec(line)?.[1], path: /\bpath=(\S+)/.exec(line)?.[1] };
    }
    if (["POST", "PUT", "PATCH"].includes(f.method) && typeof f.path === "string" && write.test(f.path)) out.push(`${f.method} ${f.path}`);
  }
  return out;
}

const listed2xx = (reqs) => (reqs ?? []).filter((r) => r.status >= 200 && r.status < 300);

/** The server comments panel in the editor page: how many, and the comment ids it lists (fork CollabPanel.tsx:526-528, CollabThread.tsx:712). */
export function panelListing() {
  const panels = document.querySelectorAll("aside.collab-panel");
  const panel = panels[0] ?? null;
  return { panels: panels.length, commentIds: panel ? [...panel.querySelectorAll("[data-comment-id]")].map((el) => el.getAttribute("data-comment-id")) : [] };
}

/**
 * The docx editor's in-document highlights of one server comment (fork
 * apps/docs/src/renderer/server-comments/anchor-tracker.ts:49,58-61): drawn only while the tracker
 * holds a live range for a listed, open root, so 0 after a Save means the range collapsed.
 */
export function serverCommentMark({ commentId }) {
  const els = [...document.querySelectorAll("[data-server-comment]")].filter((el) => el.getAttribute("data-server-comment") === commentId);
  return { marks: els.length, text: els.map((el) => el.textContent ?? "").join("").slice(0, 80) };
}

/** The bound for the editor's first list after the panel opens (the open itself polls once, comments-poll.ts:118-123). */
export const EDITOR_LIST_BOUND_MS = 35_000;
const ORDER_WAIT_TICKS = 1_000;
// what the "first list" signal is, recorded in the artifact (G819-BE-8b): server/internal/middleware/request_logger.go logs the
// path without the query or any client field, so the editor's list cannot be told from another list of the same document
const FIRST_LIST_SIGNAL =
  "path only: the server log has no query, so a kind=discussion list of the same document would also match; none occurs in this flow " +
  "(the Discussion panel opens only on a Discussion reveal, and the harness lists nothing of this document before its Save)";
const PANEL_SHOW_BOUND_MS = 10_000;

/**
 * Opens the editor's comments panel through PANEL_OPENERS unless `probe()` already shows
 * one, then waits (bounded) for it; resolves `{ status: "ok"|"error", panels, reason?, opened }`.
 */
export async function openCommentsPanel({ ctrl, page, format, probe, sleep = realSleep, now = Date.now }) {
  const first = await probe();
  if (first?.panels) return { status: "ok", panels: first.panels, opened: false };
  const opener = PANEL_OPENERS[format];
  if (!opener) return { status: "error", reason: `no panel opener for ${format}`, panels: 0, opened: false };
  const ran = await runEditPlan(ctrl, page, opener.plan);
  if (ran.status !== "ok") return { status: "error", reason: `opener step ${ran.at}: ${ran.reason}`, panels: 0, opened: false };
  const shown = await pollUntil(probe, (v) => Boolean(v?.panels), { boundMs: PANEL_SHOW_BOUND_MS, intervalMs: 500, sleep, now });
  if (!shown.ok) {
    const what = opener.plan.map((a) => a.name ?? a.selector).join(" > ");
    return { status: "error", reason: `no comments panel ${shown.elapsedMs} ms after pressing ${what}`, panels: 0, opened: true };
  }
  return { status: "ok", panels: shown.value.panels, opened: true };
}

const rowState = (row) =>
  row
    ? { id: row.id, anchor: row.anchor ?? null, anchor_state: row.anchor_state ?? null, anchor_version_id: row.anchor_version_id ?? null, anchor_version_no: row.anchor_version_no ?? null, deleted_at: row.deleted_at ?? null }
    : null;

// ---- G8-A02 decision ----------------------------------------------------------------------

/** Owner candidate of a desktop whose Save round leaves an anchor behind. */
export const CLOSED_PANEL_OWNER = "g8-fork_editors / Lead F";

/** Fork 7d665a54: the post-Save anchor round of each editor, built only from the roots its collab controller has listed. */
export const ANCHOR_ROUND_CITES = Object.freeze({
  docx: "apps/docs/src/renderer/server-comments/ServerCommentsHost.tsx:194-203",
  xlsx: "apps/sheets/src/renderer/server-comments/SheetsServerComments.tsx:207-213",
  pptx: "apps/slides/src/renderer/use-server-comments.ts:158-166",
  pdf: "apps/pdf/src/renderer/server-comments/PdfServerComments.tsx:178-202",
});
const LIST_ONCE_CITE = "packages/ui/src/collab/use-collab-threads.ts:455-475";
const POLL_GATE_CITE = "packages/electron-utils/src/comments-poll.ts:128-131";
const LOST_KEEPS_CITE = "server/internal/service/document_comment_anchors.go:434-440";

/**
 * Why the docx round reports lost after a Save (fork 7d665a54): the editor reloads the document
 * from the saved bytes with one setContent, the tracker maps every live range through that
 * whole-document replace and collapses it, and the round then sends `lost` for each root.
 */
export const DOCX_SAVE_RELOAD_CITES = Object.freeze([
  "apps/docs/src/renderer/file-actions.ts:1125-1148 (after a Save: setContent from the saved bytes unless the doc is equal)",
  "apps/docs/src/renderer/server-comments/anchor-tracker.ts:79-91 (a range whose text was replaced collapses to null)",
  "apps/docs/src/renderer/server-comments/anchor-sync.ts:25-31 (a null tracked range is sent as lost)",
]);

const markTrail = (m) =>
  m && ["beforeEdit", "afterEdit", "afterSave"].some((k) => typeof m[k] === "number")
    ? `; highlight before edit ${m.beforeEdit ?? "?"}, after edit ${m.afterEdit ?? "?"}, after Save ${m.afterSave ?? "?"}`
    : "";

/**
 * A docx edit plan must leave the quote in the saved head at the expected block; otherwise the
 * harness moved or changed the anchored text itself (harness fault, not a product FAIL).
 */
function driverFault(part) {
  const want = part?.expected?.format === "docx" ? part.expected.path?.[0] : undefined;
  const hq = part?.headQuote;
  if (want === undefined || !hq || !("block" in hq)) return null;
  if (hq.block === null) return `edit driver: the saved head no longer holds the quote "${part.expected.quote}" (want block ${want})`;
  if (hq.block !== want) return `edit driver: the saved head holds the quote at block ${hq.block}, want ${want}`;
  return null;
}

/**
 * A row the desktop reported lost: only the editor's anchor round writes `lost`, and the server
 * keeps the last anchor and its version for it (R1-7), so the round ran. The docx reason names
 * its post-Save reload; other formats get no cite they do not need.
 */
export function lostOnSaveReason(format, part) {
  const head = part?.headQuote?.block !== undefined && part.headQuote.block !== null ? `the saved head holds the quote at block ${part.headQuote.block}, ` : "";
  const why =
    format === "docx"
      ? `: ${head}yet after a Save the docs editor reloads the document from the saved bytes (${DOCX_SAVE_RELOAD_CITES.join("; ")}), so the round (${ANCHOR_ROUND_CITES.docx}) sends lost`
      : "";
  return `${why}; the server keeps the last anchor and version of a lost row (${LOST_KEEPS_CITE})${markTrail(part?.marks)}`;
}

/**
 * The closed-panel scenario must show the cross-host order: the desktop opened the document, its
 * editor's first list reached the server, and only then was the comment made. A comment that does
 * not postdate that list may have been listed at mount, so the run proves nothing either way.
 */
function scenarioFault(sc) {
  if (!sc) return "no scenario was recorded (open, the editor's first list, the comment)";
  if (typeof sc.listedAt !== "number") return "no list request of the editor was seen after the open (want: open, the editor's first list, then the comment)";
  if (typeof sc.openedAt === "number" && sc.listedAt < sc.openedAt) return `the first list ${sc.listedAt} is before the open ${sc.openedAt}`;
  if (typeof sc.createdAt !== "number" || sc.createdAt <= sc.listedAt) {
    return `the comment created ${sc.createdAt ?? "never"} is not after the editor's first list ${sc.listedAt}, so the editor may have listed it at mount`;
  }
  return null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const rowWhere = (row, part) => `row on ${row.anchor_version_id}, ${row.anchor_state}, at ${describeAnchor(row.anchor)}; head ${part.headVersionId}; owner candidate ${CLOSED_PANEL_OWNER}`;

/**
 * check:closed-panel-save (pure): a comment made with the panel closed, a structural edit before
 * its anchor and a Save must leave the row exact on the new head at the moved place. A row the
 * round reported lost and a row the round never covered are two different product findings (never
 * BLOCKED); a docx head that lost the quote is the edit driver's fault; a setup failure passes its reason.
 */
export function decideClosedPanel(part, format) {
  if (!part) return { status: "FAIL", reason: "the closed-panel Save did not run" };
  if (!part.ran) return { status: "FAIL", reason: part.reason ?? "the closed-panel Save did not run" };
  const unset = scenarioFault(part.scenario);
  if (unset) return { status: "FAIL", reason: `scenario not established: ${unset}` };
  const sc = part.scenario;
  const round = ANCHOR_ROUND_CITES[format] ?? "the editor's anchor round";
  const relists = sc.listsBeforeSave ?? 0;
  if (part.edited?.status !== "ok") return { status: "FAIL", reason: `edit driver: ${part.edited?.reason ?? "did not run"}` };
  if (!part.saved) return { status: "FAIL", reason: "Save failed" };
  const row = part.row;
  if (!row) return { status: "FAIL", reason: "the comment row is missing after Save" };
  if (!part.headVersionId || part.headVersionId === part.versionBefore) return { status: "FAIL", reason: `Save made no new version (head ${part.headVersionId ?? "none"})` };
  const fault = driverFault(part);
  if (fault) return { status: "FAIL", reason: fault };
  if (row.anchor_state === "lost") {
    return { status: "FAIL", reason: `desktop reported the anchor lost on Save${lostOnSaveReason(format, part)} (${rowWhere(row, part)})`, owner: CLOSED_PANEL_OWNER };
  }
  if (row.anchor_version_id !== part.headVersionId) {
    const order = `it was made after the editor's first list (opened ${sc.openedAt}, listed ${sc.listedAt} by ${sc.listedVia}, created ${sc.createdAt})`;
    const why =
      relists > 0
        ? `, although ${plural(relists, "list request")} for the document reached the server between the comment and the Save; the round (${round}) covers only the listed roots`
        : `, and the editor's round covers only the roots its comments controller has listed (${round}), which lists once when the editor mounts (${LIST_ONCE_CITE}) ` +
          `and with the panel closed never reloads (${POLL_GATE_CITE}): no list request between the comment and the Save`;
    return {
      status: "FAIL",
      reason: `desktop did not re-anchor this comment on Save: ${order}${why}; the server anchor stays on the old version (${rowWhere(row, part)})`,
      owner: CLOSED_PANEL_OWNER,
    };
  }
  const reasons = [];
  if (row.anchor_state !== "exact") reasons.push(`anchor_state ${row.anchor_state}, want exact`);
  if (!anchorMatches(part.expected, row.anchor)) reasons.push(`anchor at ${describeAnchor(row.anchor)}, want ${describeAnchor(part.expected)}`);
  if (reasons.length > 0) return check(reasons);
  const note =
    relists > 0
      ? `the editor listed the document again (${plural(relists, "list request")} between the comment and the Save), so its round (${round}) covered it`
      : `no list request reached the server between the comment and the Save, yet the round (${round}), built from the listed roots, re-anchored it; the order is in details.closedPanel.scenario`;
  return { status: "PASS", note };
}

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
 * byte-equal 400 anchor_version_invalid, nothing written), lost-view-version (judged
 * right after remove-lost: the lost row names the shift head's version and ordinal, the
 * web opens it read-only and `?comment=` alone follows once, the desktop view ticket opens
 * the @vN copy; BLOCKED while the web frame pin predates the fork UNI-2033 protocol,
 * NOT_JUDGED when remove-lost failed) and web-to-desktop (BLOCKED(R1) while the frame pin
 * is old). FAIL beats BLOCKED beats PASS.
 */
export function decideG8A02(rec) {
  const steps = {};
  steps["check:closed-panel-save"] = decideClosedPanel(rec.closedPanel, rec.format);
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
    const fault = driverFault(s);
    if (fault) return [...reasons, fault];
    if (row.anchor_state === "lost") return [...reasons, `desktop reported the anchor lost on Save, want exact at ${describeAnchor(s.expected)}${lostOnSaveReason(rec.format, s)}`];
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

  // the shift's product failure left the row lost already: remove-lost lost its precondition (an exact row)
  steps["check:remove-lost"] =
    steps["check:shift"].status === "FAIL" && rec.shift?.row?.anchor_state === "lost"
      ? {
          status: "NOT_JUDGED",
          cascadeFrom: "check:shift",
          reason:
            "not judged: check:shift failed first (the desktop reported the anchor lost on the shift Save), so the row was already lost before the target was deleted and deleting it proves nothing",
        }
      : decideEdit("remove", rec.remove, (r) => {
          const row = r.row;
          if (!row) return ["the thread is gone after the target was deleted (it must stay)"];
          const reasons = [];
          if (row.deleted_at) reasons.push("the thread was deleted with its target");
          if (row.anchor_state !== "lost") reasons.push(`anchor_state ${row.anchor_state}, want lost`);
          if (!(r.replies >= 1)) reasons.push("the reply did not survive");
          // server R1-7 (document_comment_anchors.go:434-440): a lost report keeps the stored anchor and its version
          const kept = rec.shift?.row?.anchor_version_id;
          if (row.anchor_state === "lost" && kept && row.anchor_version_id !== kept) reasons.push(`a lost anchor must keep its last version ${kept}, got ${row.anchor_version_id}`);
          return reasons;
        });

  // the lost view needs the row the remove step left lost: BLOCKED with it, NOT_JUDGED (cascading) when it failed
  const removed = steps["check:remove-lost"];
  steps["check:lost-view-version"] =
    removed.status === "PASS"
      ? decideLostViewVersion(rec.lostView)
      : removed.status === "BLOCKED"
        ? { status: "BLOCKED", blocker: removed.blocker ?? "", owner: removed.owner ?? "", reason: "not judged: check:remove-lost is BLOCKED, so no row was left lost" }
        : {
            status: "NOT_JUDGED",
            cascadeFrom: removed.status === "NOT_JUDGED" ? removed.cascadeFrom : "check:remove-lost",
            reason: "not judged: check:remove-lost did not leave the row lost, so there is no version to open",
          };

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

  steps["check:web-to-desktop"] = decideWebToDesktop(rec.webToDesktop);

  return { ...decideFromSteps(steps), steps };
}

/**
 * The web -> desktop direction (pure): the web frame's Save made a version, the
 * server row is exact on that version at the moved anchor, and the desktop list
 * reads the same anchor. A part that already carries a status (R1 BLOCKED, a
 * step FAIL) passes through.
 */
export function decideWebToDesktop(part) {
  if (!part) return { status: "FAIL", reason: "the web -> desktop direction did not run" };
  if (!part.ran) return { status: part.status ?? "FAIL", ...(part.reason ? { reason: part.reason } : {}), ...(part.blocker ? { blocker: part.blocker, owner: part.owner ?? "" } : {}) };
  const saved = part.saved;
  if (saved?.status !== "saved" || !saved.versionId) return { status: "FAIL", reason: `web Save: ${saved?.status ?? "did not run"}${saved?.reason ? ` (${saved.reason})` : ""}` };
  const reasons = [];
  const row = part.serverRow;
  if (!row) reasons.push("the server has no row for the web comment");
  else {
    if (row.anchor_version_id !== saved.versionId) reasons.push(`anchor stayed on version ${row.anchor_version_id}, the web Save made ${saved.versionId}`);
    if (row.anchor_state !== "exact") reasons.push(`anchor_state ${row.anchor_state}, want exact`);
    if (!anchorMatches(part.expected, row.anchor)) reasons.push(`server anchor at ${describeAnchor(row.anchor)}, want ${describeAnchor(part.expected)}`);
  }
  const desk = part.desktopRow;
  if (!desk) reasons.push("the desktop list has no row for the web comment");
  else {
    if (!anchorMatches(part.expected, desk.anchor)) reasons.push(`the desktop reads ${describeAnchor(desk.anchor)}, want ${describeAnchor(part.expected)}`);
    if (desk.anchor_version_id !== saved.versionId) reasons.push(`the desktop reads version ${desk.anchor_version_id}, want ${saved.versionId}`);
  }
  return check(reasons);
}

// ---- check:lost-view-version (UNI-2033 T7) ---------------------------------------------------------

const bannerNamesVersion = (text, n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(String(text ?? ""));

/** The server half: the row the remove step left lost keeps the shift Save's head version, and says its ordinal. */
function decideLostServer(part, expected) {
  if (!part?.ran) return { status: part?.status ?? "FAIL", reason: part?.reason ?? "the server read did not run" };
  const row = part.row;
  if (!row) return { status: "FAIL", reason: "the comment row is missing" };
  const reasons = [];
  if (row.anchor_state !== "lost") reasons.push(`anchor_state ${row.anchor_state}, want lost`);
  if (row.anchor_version_id !== expected.versionId) reasons.push(`anchor_version_id ${row.anchor_version_id ?? null}, want ${expected.versionId} (the head of the Save before the delete)`);
  if (row.anchor_version_no !== expected.versionNo) reasons.push(`anchor_version_no ${row.anchor_version_no ?? null}, want ${expected.versionNo} (the ordinal of ${expected.versionId})`);
  return check(reasons);
}

/** The web half: the read-only version view of N with the thread revealed and no write, then the `?comment=` landing, once. */
function decideLostWeb(part, versionNo, commentId) {
  if (!part) return { status: "FAIL", reason: "the web view did not run" };
  if (!part.ran) return { status: part.status ?? "FAIL", ...(part.reason ? { reason: part.reason } : {}), ...(part.blocker ? { blocker: part.blocker, owner: part.owner ?? "" } : {}) };
  const reasons = [];
  const v = part.view ?? {};
  if (v.unavailable) reasons.push(`the page shows version ${versionNo} as unavailable`);
  else if (!v.banner) reasons.push("no read-only version banner on the version view");
  else if (!bannerNamesVersion(v.banner, versionNo)) reasons.push(`the banner names another version ("${v.banner}"), want version ${versionNo}`);
  if (!(v.contentVersions ?? []).map(String).includes(String(versionNo))) reasons.push(`the frame never fetched the bytes of version ${versionNo} (fetched: ${(v.contentVersions ?? []).join(", ") || "none"})`);
  if (!v.revealed) reasons.push(`thread ${commentId} is not revealed in the version view`);
  if ((v.writes ?? []).length > 0) reasons.push(`a write request during the version view: ${v.writes.join(", ")}`);
  if ((v.serverLogWrites ?? []).length > 0) reasons.push(`the server log saw a write during the version view: ${v.serverLogWrites.join(", ")}`);
  const land = part.landing;
  if (!land) reasons.push("the ?comment= landing did not run");
  else if ((land.switches ?? []).length === 0) reasons.push(`?comment= alone did not switch to ?version=${versionNo} (the page stayed on ${land.finalUrl})`);
  else {
    if (land.switches.length > 1) reasons.push(`?comment= alone switched more than once (${land.switches.length} times)`);
    const final = new URL(land.finalUrl, "http://x");
    if (final.searchParams.get("version") !== String(versionNo) || final.searchParams.get("comment") !== commentId) reasons.push(`landed on ${land.finalUrl}, want version=${versionNo}&comment=${commentId}`);
  }
  return check(reasons);
}

/**
 * The desktop half: the view ticket opened the `@vN` copy. Judged only on what the app reports: the copy
 * path, a read-only flag, the version id the copy's comments bridge answers and the editor's panel listing
 * the comment; a fact the app does not report is recorded in `note`, not failed.
 */
function decideLostDesktop(part, expected, commentId) {
  if (!part) return { status: "FAIL", reason: "the desktop view did not run" };
  if (!part.ran) return { status: part.status ?? "FAIL", ...(part.reason ? { reason: part.reason } : {}) };
  const reasons = [];
  const notes = [];
  if (!String(part.copyPath ?? "").includes(`@v${expected.versionNo}`)) reasons.push(`the opened copy ${part.copyPath ?? "none"} is not the @v${expected.versionNo} copy`);
  const st = part.status ?? {};
  if (st.readOnly === false || st.access === "edit") reasons.push(`the @v${expected.versionNo} copy is not read-only (${JSON.stringify(st)})`);
  else if (st.readOnly === undefined && st.access === undefined) notes.push("the read-only flag");
  if (typeof part.contextVersionId === "string") {
    if (part.contextVersionId !== expected.versionId) reasons.push(`the copy's open version id is ${part.contextVersionId}, want ${expected.versionId}`);
  } else notes.push("the copy's open version id");
  const panel = part.panel ?? {};
  if ((panel.panels ?? 0) > 0) {
    if (!(panel.commentIds ?? []).includes(commentId)) reasons.push(`the editor's comments panel does not list comment ${commentId}`);
  } else notes.push("the revealed thread (no comments panel is open)");
  const res = check(reasons);
  return res.status === "PASS" && notes.length > 0 ? { ...res, note: `not reported by the app: ${notes.join("; ")}` } : res;
}

/**
 * check:lost-view-version from `rec.lostView` (pure): server, web and desktop are judged apart and combined
 * the way the row is, FAIL beats BLOCKED beats PASS (the web half is BLOCKED while the frame pin predates the fork protocol).
 */
export function decideLostViewVersion(lv) {
  if (!lv?.ran) return { status: "FAIL", reason: lv?.skipped ?? "the lost-view step did not run" };
  if (lv.expected?.conflict) return { status: "FAIL", reason: `harness: ${lv.expected.conflict}` };
  const expected = lv.expected ?? {};
  const commentId = lv.commentId ?? lv.server?.row?.id ?? "";
  const parts = {
    server: decideLostServer(lv.server, expected),
    web: decideLostWeb(lv.web, expected.versionNo, commentId),
    desktop: decideLostDesktop(lv.desktop, expected, commentId),
  };
  const decided = decideFromSteps(parts);
  const notes = Object.values(parts).map((p) => p.note).filter(Boolean);
  const { reason, ...rest } = decided;
  return { ...rest, ...(reason ? { reason } : {}), ...(notes.length > 0 ? { note: notes.join("; ") } : {}) };
}

/** What the artifact says about the third 400 case (lead decision r1b, applied-pending-Advisor). */
export const PURGED_CASE_NOTE =
  "purged-version case replaced by empty id: no REST purge route (router/documents.go), same single lookup document_comment_anchors.go:362-369";

// The editors install the control hook in their renderer (no Electron gate), so the same
// plans run in the web frame: fork apps/docs/src/renderer/App.tsx:6220-6223,
// apps/sheets/src/renderer/App.tsx:5116, apps/slides/src/renderer/App.tsx:3405, apps/pdf/src/renderer/App.tsx:1817.
const WEB_FRAME_EVAL_MS = 30_000;

/** Runs one plan in the web frame through webFrameEval; the first action that is not ok stops it. */
async function runWebEditPlan(web, page, kind, actions) {
  for (const [i, action] of actions.entries()) {
    const res = await web.webFrameEval(page, kind, pageAction, action, { timeoutMs: WEB_FRAME_EVAL_MS });
    if (res?.status !== "ok") return { status: "error", at: i, reason: res?.reason ?? `web frame action ${i} (${action.type}) answered nothing` };
  }
  return { status: "ok" };
}

/**
 * G8-A02 web -> desktop (runs only once R1 lifts): A opens a third upload on the web, the
 * pdf plan prepares and saves first, A comments on the fixture anchor over REST, the web page
 * reloads so the frame loads that comment, the shift plan runs in the frame and webSave saves;
 * the row must be exact on the saved version, and the signed-in desktop opens the document and
 * lists the moved anchor. Fills `part` as it goes; the decision is decideWebToDesktop.
 */
async function runWebToDesktop({ ctx, world, desk, format, driver, web, launchBrowser, poll, part }) {
  const A = world.session("A");
  const kind = editorKindOfFormat(format);
  const doc = await world.upload("A", "W2", ctx.fixture, { title: `G8-A02 web ${ctx.fixture}` });
  part.documentId = doc.documentId;
  const where = { webOrigin: ctx.webOrigin, org: world.org("X").slug, ws: world.workspace("X", "W2").slug, documentId: doc.documentId };
  const browser = await launchBrowser();
  try {
    const session = await web.webLogin(browser, world.user("A"), { webOrigin: ctx.webOrigin });
    const open = async () => {
      const opened = await web.openDocument(session.page, where);
      if (opened.status !== "ok") throw new Error(`web open answered ${opened.status}${opened.reason ? ` (${opened.reason})` : ""}`);
    };
    await open();
    if (driver.prepare) {
      const prepared = await runWebEditPlan(web, session.page, kind, driver.prepare);
      if (prepared.status !== "ok") throw new Error(`web prepare edit: ${prepared.reason}`);
      const saved = await web.webSave(session.page, { kind });
      if (saved.status !== "saved") throw new Error(`web prepare Save: ${saved.status}${saved.reason ? ` (${saved.reason})` : ""}`);
    }
    const base = (await readServer(A, doc.documentId)).head;
    const anchor = anchorForFixture(ctx.fixture, { repoRoot: ctx.repoRoot });
    const made = await A.call("createDocumentComment", { documentID: doc.documentId }, { body: `G8-A02 web ${ctx.fixture}`, kind: "comment", anchor, base_version_id: base });
    if (!made.ok || !made.body?.comment?.id) throw new Error(`createDocumentComment answered ${made.status}`);
    const commentId = made.body.comment.id;
    Object.assign(part, { commentId, versionBefore: base, expected: expectedAfterShift(anchor) });
    await open();
    part.edited = await runWebEditPlan(web, session.page, kind, driver.shift);
    if (part.edited.status !== "ok") throw new Error(`web edit driver: ${part.edited.reason}`);
    part.saved = await web.webSave(session.page, { kind });
    await Promise.resolve(session.close?.()).catch(() => {});
    if (part.saved.status !== "saved") return;
    const rowOf = (srv) => srv.comments.find((r) => r.id === commentId) ?? null;
    const settled = await poll(
      () => readServer(A, doc.documentId),
      (srv) => rowOf(srv)?.anchor_version_id === part.saved.versionId && rowOf(srv)?.anchor_state === "exact",
    );
    part.serverRow = rowState(rowOf(settled.value));
    const opened = await openTicketOnDesktop({ ctx, world, ctrl: desk.ctrl, documentId: doc.documentId, format });
    const listed = unwrap(await opened.comments.list({ path: opened.path, kind: "comment" }), "comments.list");
    const deskRow = (listed?.comments ?? []).find((r) => r.id === commentId) ?? null;
    part.desktopRow = deskRow ? { anchor: deskRow.anchor ?? null, anchor_version_id: deskRow.anchor_version_id ?? null } : null;
  } finally {
    await Promise.race([Promise.resolve().then(() => browser.close?.()).catch(() => {}), realSleep(2_000)]);
  }
}

// ---- check:lost-view-version: the web view and the Inbox landing -----------------------------------

const VIEW_OPEN_BOUND_MS = 60_000;
const VIEW_REVEAL_BOUND_MS = 20_000;
/** How long the view is watched for a Save or anchors request after it has settled (a write that follows the open, not one that races it). */
const VIEW_QUIET_MS = 3_000;
const LANDING_QUIET_MS = 2_000;

/**
 * In the page: the version view markers D renders (packages/views/office/frame/frame-version-banner.tsx
 * `office-version-view-banner` / `office-version-view-unavailable`, office-module-frame.tsx `data-state`) and
 * whether D's own comments pane shows `commentId` highlighted (document-comment-thread.tsx `data-highlighted`).
 */
export function readVersionViewPage({ commentId }) {
  const banner = document.querySelector('[data-testid="office-version-view-banner"]');
  const host = document.querySelector("[data-office-docs-frame]");
  const thread = [...document.querySelectorAll('[data-testid^="document-thread-"]')].find((el) => el.getAttribute("data-testid") === `document-thread-${commentId}`);
  return {
    banner: banner ? (banner.textContent ?? "").trim() : null,
    unavailable: document.querySelector('[data-testid="office-version-view-unavailable"]') !== null,
    frameState: host?.getAttribute("data-state") ?? null,
    highlighted: Boolean(thread && thread.hasAttribute("data-highlighted")),
  };
}

const pathOf = (url) => {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url);
  }
};

/**
 * Opens `?version=N&comment=<id>` as the page's user and records, from the page and the requests it makes:
 * the version banner (read-only marker), the version the frame fetched bytes for, whether the thread is
 * revealed (the frame's comments panel lists it or D's pane highlights it), and every Save commit / comments.anchors
 * write (the browser's own requests, and the server log after the open). Then opens `?comment=<id>` alone
 * and records the URLs the page switches to. Resolves `{ ran: true, view, landing }`. Every wait is a bounded poll.
 */
export async function observeVersionView({ web, page, kind, where, commentId, versionNo, documentId, serverLog = null, sleep = realSleep, now = Date.now }) {
  const requests = [];
  const contentVersions = [];
  const urls = [];
  const writeRoute = new RegExp(`/documents/${documentId}/(versions/commit|comments/anchors)$`);
  page.on("request", (req) => {
    const method = req.method();
    const path = pathOf(req.url());
    if ((method === "POST" || method === "PUT") && writeRoute.test(path)) requests.push(`${method} ${path}`);
  });
  page.on("response", (res) => {
    const url = res.url();
    if (res.request().method() !== "GET" || !pathOf(url).endsWith(`/office-frame/documents/${documentId}/content`)) return;
    const status = res.status();
    const version = new URL(url).searchParams.get("version");
    if (version && status >= 200 && status < 300) contentVersions.push(version);
  });
  page.on("framenavigated", (frame) => {
    if (typeof page.mainFrame !== "function" || frame === page.mainFrame()) {
      const url = frame.url();
      if (urls[urls.length - 1] !== url) urls.push(url);
    }
  });
  const poll = (fn, pred, boundMs, intervalMs = 500) => pollUntil(fn, pred, { boundMs, intervalMs, sleep, now });

  // 1. the version view
  const logOffset = logSize(serverLog);
  const viewUrl = new URL(realWeb.documentUrl({ ...where, comment: commentId }));
  viewUrl.searchParams.set("version", String(versionNo));
  await page.goto(viewUrl.toString(), { waitUntil: "domcontentloaded", timeout: VIEW_OPEN_BOUND_MS });
  const read = await poll(
    () => page.evaluate(readVersionViewPage, { commentId }).catch(() => null),
    (r) => Boolean(r?.unavailable || (r?.banner && r.frameState === "ready")),
    VIEW_OPEN_BOUND_MS,
  );
  const page1 = read.value ?? {};
  const panel = await poll(
    async () => (await web.webFrameEval(page, kind, panelListing, undefined, { timeoutMs: 10_000 }).catch(() => null)) ?? { panels: 0, commentIds: [] },
    (p) => (p.commentIds ?? []).includes(commentId),
    VIEW_REVEAL_BOUND_MS,
  );
  const inPanel = (panel.value?.commentIds ?? []).includes(commentId);
  const revealed = inPanel || Boolean(page1.highlighted);
  await sleep(VIEW_QUIET_MS);
  const view = {
    url: viewUrl.toString(),
    banner: page1.banner ?? null,
    unavailable: Boolean(page1.unavailable),
    frameState: page1.frameState ?? null,
    contentVersions: [...contentVersions],
    revealed,
    revealedIn: inPanel ? "the frame's comments panel" : page1.highlighted ? "D's comments pane (highlighted thread)" : "nowhere",
    writes: [...requests],
    serverLogWrites: documentWriteRequests(serverLog, logOffset, documentId),
  };

  // 2. the Inbox landing: ?comment= alone follows the lost comment to its version, once
  const landStart = urls.length;
  const startUrl = realWeb.documentUrl({ ...where, comment: commentId });
  await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: VIEW_OPEN_BOUND_MS });
  await poll(() => Promise.resolve(page.url()), (url) => url.includes("version="), VIEW_OPEN_BOUND_MS);
  await sleep(LANDING_QUIET_MS);
  const switches = urls.slice(landStart).filter((url) => new URL(url).searchParams.has("version"));
  return { ran: true, view, landing: { startUrl, finalUrl: page.url(), switches } };
}

// ---- G8-A02 flow ---------------------------------------------------------------------------

/** How many pages of `kind` the app shows (diagnostic; the page is picked by path, harness contract §15). */
function countEditorPages(ctrl, kind) {
  try {
    return ctrl.browser.contexts().flatMap((c) => c.pages()).filter((p) => editorKindOfUrl(p.url()) === kind).length;
  } catch {
    return null;
  }
}

/** Why the closed-panel record has no desktop page count around the shift edit (pdf only). */
const PDF_PAGE_COUNT_NOTE = "no page count is exposed by the desktop driver or the app control (control.ts offers goto only; focus() counts windows, not pages); recorded null, no product code added";

/**
 * check:closed-panel-save flow (panel never opened), the cross-host case: the document is open on the
 * desktop with the panel closed when someone comments on it elsewhere. pdf prepares + saves its pages;
 * the harness waits (bounded) until the server log shows the editor's first comment list after the
 * open, and only then A creates the fixture anchor over REST (another host). The shift plan edits
 * before it, Save, and the server is polled (bounded) for the row to reach the new head. The harness
 * never lists this document itself before the Save (that would read as an editor list). Fills `part`.
 */
async function runClosedPanelSave({ ctx, A, desk, driver, format, documentId, poll, part, trace, serverLog, logOffset, sleep, now }) {
  const scenario = part.scenario;
  if (format === "pdf") part.pageCount = { before: null, after: null, reason: PDF_PAGE_COUNT_NOTE };
  if (driver.prepare) {
    const headBeforePrepare = await readHead(A, documentId);
    const prepared = await runEditPlan(desk.ctrl, desk.page, driver.prepare);
    if (prepared.status !== "ok") throw new Error(`prepare edit: ${prepared.reason}`);
    await saveOnDesktop(desk.ctrl, desk.path);
    // the Save answers before its version is the head: the comment and versionBefore must come after it, or
    // the settle below would accept the prepare version and the shift Save would never be judged
    const landed = await poll(() => readHead(A, documentId), (head) => Boolean(head) && head !== headBeforePrepare);
    if (!landed.ok) return { status: "FAIL", reason: `scenario not established: the prepare Save's version did not land as the head within ${landed.elapsedMs} ms (head still ${headBeforePrepare ?? "unknown"}); the comment was not made` };
    part.prepareVersionId = landed.value;
  }
  const seen = await pollUntil(() => listed2xx(documentListRequests(serverLog, logOffset, documentId)), (v) => v.length > 0, { boundMs: EDITOR_LIST_BOUND_MS, intervalMs: 500, sleep, now });
  if (!seen.ok) {
    const why = existsSync(serverLog) ? `server.log, ${seen.elapsedMs} ms` : `no server log at ${serverLog}`;
    return { status: "FAIL", reason: `scenario not established: no list request of the editor was seen after the open (${why}); the comment was not made` };
  }
  const first = seen.value[0];
  Object.assign(scenario, { listedAt: now(), listedVia: "server.log", listLine: `GET ${API_PREFIX}/documents/${documentId}/comments ${first.status} at ${first.time ?? "?"}`, listSignal: FIRST_LIST_SIGNAL });
  const context = unwrap(await desk.comments.context({ path: desk.path }), "comments.context");
  const anchor = anchorForFixture(ctx.fixture, { repoRoot: ctx.repoRoot });
  const createOffset = logSize(serverLog);
  // the POST goes out on a later clock tick than the list was seen, so the recorded order is strict; the wait has its own bound
  for (let tick = 0; now() <= scenario.listedAt; tick += 1) {
    if (tick >= ORDER_WAIT_TICKS) return { status: "FAIL", reason: `scenario not established: the clock did not advance past the first list in ${ORDER_WAIT_TICKS} ticks; the comment was not made` };
    await sleep(1);
  }
  scenario.createdAt = now();
  scenario.createdVia = "REST as A (another host, the desktop panel closed)";
  const res = await A.call("createDocumentComment", { documentID: documentId }, { body: `G8-A02 closed panel ${ctx.fixture}`, kind: "comment", anchor, base_version_id: context.versionId });
  const root = res.body?.comment;
  if (!res.ok || !root?.id) throw new Error(`POST comments as A answered ${res.status}${res.error ? ` (${res.error})` : ""}`);
  if (root.created_at) scenario.serverCreatedAt = root.created_at;
  const versionBefore = await readHead(A, documentId);
  Object.assign(part, { commentId: root.id, anchor, versionBefore, expected: expectedAfterShift(anchor) });
  await trace.mark(part, "beforeEdit", desk, root.id);
  part.edited = await runEditPlan(desk.ctrl, desk.page, driver.shift);
  if (part.edited.status !== "ok") return { status: "FAIL", reason: `edit driver: ${part.edited.reason}` };
  await trace.mark(part, "afterEdit", desk, root.id);
  part.saved = false;
  scenario.listsBeforeSave = listed2xx(documentListRequests(serverLog, createOffset, documentId)).length;
  await saveOnDesktop(desk.ctrl, desk.path);
  part.saved = true;
  const rowOf = (srv) => srv.comments.find((r) => r.id === root.id) ?? null;
  // the row was exact before this Save: lost now is the Save round's own answer (it keeps the version, R1-7)
  const settled = await poll(
    () => readServer(A, documentId),
    (srv) => Boolean(srv.head && srv.head !== versionBefore && (rowOf(srv)?.anchor_version_id === srv.head || rowOf(srv)?.anchor_state === "lost")),
  );
  Object.assign(part, { headVersionId: settled.value.head, row: rowState(rowOf(settled.value)), elapsedMs: settled.elapsedMs });
  await trace.mark(part, "afterSave", desk, root.id);
  await trace.headQuote(part, documentId, settled.value);
  return settled.ok ? {} : { status: "FAIL", reason: `the anchor did not reach the new version within ${settled.elapsedMs} ms` };
}

/**
 * Bounded docx diagnostics (cloud r2 could not tell a product loss from a driver that moved the
 * text): the editor's highlight of the comment before the edit, after it and after the Save, and
 * the block of the saved head that holds the quote. Other formats record nothing; a probe that
 * fails records its error, never the row's verdict.
 */
function docxTrace({ format, ctx, world, download }) {
  if (format !== "docx") return { mark: async () => {}, headQuote: async () => {} };
  return {
    async mark(part, when, desk, commentId) {
      try {
        const m = await desk.ctrl.evalBounded(desk.page, serverCommentMark, { commentId }, "probe:mark");
        part.marks = { ...part.marks, [when]: typeof m?.marks === "number" ? m.marks : null };
      } catch (err) {
        part.marks = { ...part.marks, [when]: null, [`${when}Error`]: String(err?.message ?? err).slice(0, 160) };
      }
    },
    async headQuote(part, documentId, srv) {
      if (!srv?.headVersion || !part.expected?.quote) return;
      try {
        const get = download ?? ((id, version) => downloadVersion({ apiOrigin: ctx.apiOrigin, token: world.user("A").token, documentId: id, version }));
        part.headQuote = { block: docxQuoteBlock(await get(documentId, srv.headVersion), part.expected.quote), version: srv.headVersion };
      } catch (err) {
        part.headQuote = { error: String(err?.message ?? err).slice(0, 160), version: srv.headVersion };
      }
    },
  };
}

/** Saves `path` through the app; a reply that says it did not save throws. */
export async function saveOnDesktop(ctrl, path) {
  const res = await ctrl.save(path);
  if (res && (res.ok === false || res.error)) throw new Error(`uniworkSave: ${res.error?.code ?? res.error ?? "not saved"}`);
  return res;
}

/** The part of a failed half: what the decision reads (`ran: false` carries the status and reason). */
const failedPart = (err) => ({ ran: false, status: "FAIL", reason: err instanceof Error ? err.message : String(err) });

/** The fields of the app's active-document status the lost view can judge (a field the app does not report is absent). */
const pickDocStatus = (status) => Object.fromEntries(["readOnly", "access", "mode"].filter((k) => status && typeof status === "object" && k in status).map((k) => [k, status[k]]));

/**
 * check:lost-view-version flow (the row is lost after the remove step). Three halves, each recorded in
 * `rec.lostView` and judged by decideLostViewVersion:
 * - server: the lost row's anchor_version_id is the shift Save's head, anchor_version_no its ordinal
 *   (the versions list and the head's `version` at the shift Save must agree);
 * - web (BLOCKED by the pin probe, else a browser as A): observeVersionView;
 * - desktop: a view ticket `{operation: "view", version: N, comment_id}` opens the `...@vN` copy.
 */
async function runLostViewVersion({ ctx, world, A, desk, doc, rec, rowOf, commentId, format, poll, web, launchBrowser, framePin, isAncestor, observe, serverLog, sleep, now }) {
  const lv = { ran: true, commentId, expected: { versionId: rec.shift.headVersionId, versionNo: null }, server: null, web: null, desktop: null };
  rec.lostView = lv;
  await ctx.step("lost-view-server", async () => {
    try {
      const srv = await readServer(A, doc.documentId);
      const row = rowState(rowOf(srv));
      let listedNo = null;
      const list = await A.call("listDocumentVersions", { documentID: doc.documentId });
      if (list.ok) listedNo = (list.body?.versions ?? []).find((v) => v.id === lv.expected.versionId)?.version ?? null;
      const shiftNo = rec.shift.headVersion ?? null;
      lv.expected.versionNo = listedNo ?? shiftNo;
      if (listedNo !== null && shiftNo !== null && listedNo !== shiftNo) lv.expected.conflict = `version ${lv.expected.versionId} is number ${listedNo} in the versions list but the document said ${shiftNo} at the shift Save`;
      else if (lv.expected.versionNo === null) lv.expected.conflict = `version ${lv.expected.versionId} is not in the versions list and the shift Save recorded no version number`;
      lv.server = { ran: true, row };
    } catch (err) {
      lv.server = failedPart(err);
    }
  });
  const versionNo = lv.expected.versionNo;
  await ctx.step("lost-view-web", async () => {
    const block = framePinBlock(framePin, { isAncestor }) ?? viewVersionPinBlock(framePin, { isAncestor });
    if (block) {
      lv.web = block;
      return;
    }
    if (!(versionNo > 0)) {
      lv.web = failedPart("no version number to open (see the server half)");
      return;
    }
    let browser = null;
    let session = null;
    try {
      const where = { webOrigin: ctx.webOrigin, org: world.org("X").slug, ws: world.workspace("X", "W2").slug, documentId: doc.documentId };
      browser = await launchBrowser();
      session = await web.webLogin(browser, world.user("A"), { webOrigin: ctx.webOrigin });
      lv.web = await observe({ web, page: session.page, kind: editorKindOfFormat(format), where, commentId, versionNo, documentId: doc.documentId, serverLog, sleep, now });
    } catch (err) {
      lv.web = failedPart(err);
    } finally {
      await Promise.resolve(session?.close?.()).catch(() => {});
      await Promise.race([Promise.resolve().then(() => browser?.close?.()).catch(() => {}), realSleep(2_000)]);
    }
  });
  await ctx.step("lost-view-desktop", async () => {
    if (!(versionNo > 0)) {
      lv.desktop = failedPart("no version number to open (see the server half)");
      return;
    }
    try {
      const opened = await openTicketOnDesktop({ ctx, world, ctrl: desk.ctrl, documentId: doc.documentId, format, commentId, operation: "view", version: versionNo, copyMarker: `@v${versionNo}`, sleep, now });
      const status = await Promise.resolve(desk.ctrl.aiOffice("uniworkActiveDocStatus")).catch(() => null);
      const context = await Promise.resolve(opened.comments.context({ path: opened.path })).catch(() => null);
      const probe = () => desk.ctrl.evalBounded(opened.page, panelListing, {}, "probe:listed");
      const seen = await pollUntil(probe, (v) => Array.isArray(v?.commentIds) && v.commentIds.includes(commentId), { boundMs: VIEW_REVEAL_BOUND_MS, intervalMs: 1_000, sleep, now });
      lv.desktop = {
        ran: true,
        copyPath: opened.path,
        contextVersionId: context?.ok === true && typeof context.value?.versionId === "string" ? context.value.versionId : null,
        status: pickDocStatus(status),
        panel: { panels: seen.value?.panels ?? 0, commentIds: seen.value?.commentIds ?? [] },
      };
    } catch (err) {
      lv.desktop = failedPart(err);
    }
  });
}

/**
 * Runs G8-A02 on one fixture (ctx from runRowModule). `deps`: `connectApp`,
 * `sleep`, `now`, `framePin` (else read now), `isAncestor` (else the fork clone),
 * `web` (harness/web.mjs), `launchBrowser`, `download` (`(documentId, version)` -> bytes, docx head check),
 * `serverLog` (else the run's logs/server.log: the editor's first list of the closed-panel document),
 * `observeVersionView` (the web half of check:lost-view-version; else the Playwright driver above).
 */
export async function runG8A02(ctx, deps = {}) {
  const { connectApp = realConnectApp, sleep = realSleep, now = Date.now, web = realWeb } = deps;
  const launchBrowser = deps.launchBrowser ?? (() => loadPlaywrightChromium(ctx.repoRoot).launch({ headless: true }));
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
    const trace = docxTrace({ format, ctx, world, download: deps.download });
    let doc;
    let other;
    let closedDoc;
    let s = await ctx.step("upload", async () => {
      doc = await world.upload("A", "W2", ctx.fixture, { title: `G8-A02 ${ctx.fixture}` });
      other = await world.upload("A", "W2", ctx.fixture, { title: `G8-A02 foreign ${ctx.fixture}` });
      closedDoc = await world.upload("A", "W2", ctx.fixture, { title: `G8-A02 closed panel ${ctx.fixture}` });
      rec.documentId = doc.documentId;
    });
    if (s.status !== "PASS") return failed("upload", s);

    // first, on its own document: the normal case of a user who edits with the comments panel closed
    const serverLog = deps.serverLog ?? join(harnessPaths(ctx.runDir).logDir, "server.log");
    rec.closedPanel = { ran: true, documentId: closedDoc.documentId, scenario: { openedAt: null, listedAt: null, listedVia: null, createdAt: null, createdVia: null, listsBeforeSave: null, listSignal: null } };
    s = await ctx.step("closed-panel-save", async () => {
      const logOffset = logSize(serverLog);
      rec.closedPanel.scenario.openedAt = now();
      desk = await openOnDesktop({ ctx, world, connectApp, documentId: closedDoc.documentId, format });
      return runClosedPanelSave({ ctx, A, desk, driver, format, documentId: closedDoc.documentId, poll, part: rec.closedPanel, trace, serverLog, logOffset, sleep, now });
    });
    if (s.status === "FAIL" && !rec.closedPanel.saved && rec.closedPanel.edited?.status === undefined) rec.closedPanel = { ran: false, reason: s.reason, scenario: rec.closedPanel.scenario };

    s = await ctx.step("open-desktop", async () => {
      desk = desk?.ctrl
        ? await openTicketOnDesktop({ ctx, world, ctrl: desk.ctrl, documentId: doc.documentId, format })
        : await openOnDesktop({ ctx, world, connectApp, documentId: doc.documentId, format });
      rec.editorPagesOfKind = countEditorPages(desk.ctrl, desk.kind);
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

    // the Save anchor round covers only the roots the editor's controller has listed (located once,
    // when first listed): open its panel and wait until it lists this comment, before any edit
    s = await ctx.step("editor-lists", async () => {
      const probe = () => desk.ctrl.evalBounded(desk.page, panelListing, {}, "probe:listed");
      const opened = await openCommentsPanel({ ctrl: desk.ctrl, page: desk.page, format, probe, sleep, now });
      rec.editorLists = { panel: opened, listed: false };
      if (opened.status !== "ok") throw new Error(`open the comments panel: ${opened.reason}`);
      const seen = await pollUntil(probe, (v) => Array.isArray(v?.commentIds) && v.commentIds.includes(commentId), { boundMs: EDITOR_LIST_BOUND_MS, intervalMs: 1_000, sleep, now });
      Object.assign(rec.editorLists, { listed: seen.ok, elapsedMs: seen.elapsedMs, listedIds: seen.value?.commentIds ?? [] });
      if (!seen.ok) throw new Error(`the editor's comments panel did not list comment ${commentId} within ${seen.elapsedMs} ms (panel opened ${opened.opened})`);
    });
    if (s.status !== "PASS") return failed("editor-lists", s);

    await ctx.step("shift", async () => {
      const versionBefore = (await readServer(A, doc.documentId)).head;
      const expected = expectedAfterShift(rec.created.anchor);
      rec.shift = { saved: false, versionBefore, expected };
      await trace.mark(rec.shift, "beforeEdit", desk, commentId);
      const edited = await runEditPlan(desk.ctrl, desk.page, driver.shift);
      rec.shift.edited = edited;
      if (edited.status !== "ok") return { status: "FAIL", reason: `edit driver: ${edited.reason}` };
      await trace.mark(rec.shift, "afterEdit", desk, commentId);
      await saveOnDesktop(desk.ctrl, desk.path);
      rec.shift.saved = true;
      // exact on the new head, or lost (the round's answer for a row that was exact; it keeps the version)
      const settled = await poll(
        () => readServer(A, doc.documentId),
        (srv) => {
          const row = rowOf(srv);
          return Boolean(row && srv.head && srv.head !== versionBefore && ((row.anchor_version_id === srv.head && row.anchor_state === "exact") || row.anchor_state === "lost"));
        },
      );
      Object.assign(rec.shift, { headVersionId: settled.value.head, headVersion: settled.value.headVersion ?? null, row: rowState(rowOf(settled.value)), elapsedMs: settled.elapsedMs });
      await trace.mark(rec.shift, "afterSave", desk, commentId);
      await trace.headQuote(rec.shift, doc.documentId, settled.value);
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

    // check:lost-view-version: only when check:remove-lost holds (the row lost on the shift Save's version)
    const framePin = deps.framePin ?? readFramePin(ctx.repoRoot, format);
    const isAncestor = deps.isAncestor ?? forkAncestorChecker(process.env, ctx.portsEnv);
    rec.lostView = { ran: false, skipped: "check:remove-lost did not leave the row lost" };
    if (decideG8A02({ ...rec, lostView: undefined }).steps["check:remove-lost"].status === "PASS") {
      await runLostViewVersion({ ctx, world, A, desk, doc, rec, rowOf, commentId, format, poll, web, launchBrowser, framePin, isAncestor, observe: deps.observeVersionView ?? observeVersionView, serverLog, sleep, now });
    }

    await ctx.step("invalid-versions", async () => {
      // a purged version cannot be made through REST (no document/version delete route in
      // server/internal/handler/router/documents.go); the server answers it through the same
      // single lookup as an unknown id (server/internal/service/document_comment_anchors.go:362-369)
      const cases = [
        ["foreign", other.versionId],
        ["unknown", "01J8X4VER0N1P2Q3R4S5T6U7V8"],
        ["empty", ""],
      ];
      rec.invalidVersionsNote = PURGED_CASE_NOTE;
      rec.invalidVersions = [];
      for (const [name, versionId] of cases) {
        const res = await A.call("putDocumentCommentAnchors", { documentID: doc.documentId }, { version_id: versionId, anchors: [{ comment_id: commentId, anchor: rec.created.anchor, state: "exact" }] });
        rec.invalidVersions.push({ case: name, status: res.status, body: res.body });
      }
      rec.afterInvalid = rowState(rowOf(await readServer(A, doc.documentId)));
    });

    const block = framePinBlock(framePin, { isAncestor });
    if (block) rec.webToDesktop = block;
    else {
      const part = { ran: true };
      rec.webToDesktop = part;
      const s2 = await ctx.step("web-to-desktop", () => runWebToDesktop({ ctx, world, desk, format, driver, web, launchBrowser, poll, part }));
      if (s2.status === "FAIL") rec.webToDesktop = { ...part, ran: false, status: "FAIL", reason: s2.reason };
    }
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
