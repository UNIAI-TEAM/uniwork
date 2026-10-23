// G8-19 (UNI-1414) row module "deeplink": G8-A07 "deep link mở đúng tài liệu
// + comment/discussion + vị trí trên web và desktop; URL theo workspace của
// tài liệu; năm ngoại lệ UNI-1389; quyền kiểm lúc mở; snippet ẩn khi mất quyền".
//
// World: A owns W1 and W2; B and C are W2 members; B is the recipient.
// - main: A uploads the fixture into W2 and mentions B (on xlsx the comment is
//   anchored at sheet 2 B7). B's web Inbox row links `/{org}/{W2}/documents/{id}?comment=<id>`
//   (D packages/views/notifications/resource-href.ts:33-44, packages/core/paths/paths.ts:91;
//   server mirror server/internal/notification/push_consumer.go:116). The web page opens one
//   panel with that thread focused (packages/views/documents/document-comments-context.tsx:64-66)
//   - inside an Office frame only once the frame pin carries G8-12..15 (R1).
// - desktop: the ticket "Mở trong UniWork Office" mints carries the page's ?comment=
//   (D packages/core/office/desktop-handoff.ts:27-36; server/internal/service/office_launch.go:173,207,319);
//   the app parses comment_id (F apps/shell/src/main/uniwork-docs/parse.ts:338-345) and reveals it
//   (F apps/shell/src/main/uniwork-docs/launch.ts:212,361; packages/ui/src/collab/use-collab-threads.ts:351-377):
//   the thread takes focus and, on xlsx, the selection is `Doanh thu Q2!B7`
//   (F apps/sheets/src/renderer/control.ts:34-50 through window.__genofficeControl, App.tsx:5116).
//   The desktop tray itself opens without comment_id (F apps/shell/src/renderer/src/DeskInTray.tsx:122-124):
//   a finding for L23, not this row (lead decision Q3).
// - cross-workspace: a W1 document shared directly with B (W2 only) and a mention of B; the
//   row must be in B's Inbox and link into W2, B's open workspace (resource-href.ts:10-12).
// - the five UNI-1389 exceptions: no access (S15 row 2 no_access, document-detail-view.tsx:92-93) for B
//   once A revoked the share (the row reads resource_access_lost), while C - never given the W1 document,
//   no row - must get the gone page: the server answers 404 to a non-reader (CLAUDE.md Backend ID Rules),
//   deleted/archived (S15 gone :108-109 + resource_deleted, notification/service.go:238-244),
//   comment deleted (comment_deleted, service.go:250; the document opens, no thread),
//   anchor lost (the reveal opens the thread only, use-collab-threads.ts:373-376), session expired (/login).
// - revoke mid-session + archive: revoke.mjs revokeSteps.
//
// R1 (lead decision): while apps/web/platform/office-frame/<kind>.pin.json pins a frame older than
// fork G8-12..15 every web-in-frame sub-step is BLOCKED with WEB_FRAME_PIN_BLOCKER (owner lead-f),
// never PASS; the pin is read at run time, so a re-pin flips it with no code change.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { apiErrorText } from "../harness/api.mjs";
import { isMainModule } from "../harness/lib.mjs";
import {
  closeAll,
  combineChecks,
  commentAnchor,
  connectOrFail,
  createCommentRest,
  formatOf,
  mentionBody,
  notificationsOf,
  openOnDesktop,
  pollOpts,
  pollUntil,
  readThread,
  readThreadInPage,
  resolveDeps,
  rowsForComment,
  signInDesktop,
  verdictStep,
  waitForRows,
} from "./inbox.mjs";
import { decideRevokedLink, revokeSteps } from "./revoke.mjs";
import { B7_ANCHOR, B7_SHEET_NAME, WEB_FRAME_PIN_BLOCKER, WEB_FRAME_PIN_OWNER, rowMain } from "./run-row.mjs";

export const formatOfFixture = formatOf;

/** The frame pin file per format (apps/web/platform/office-frame/*.pin.json). */
export const FRAME_PIN_FILE = Object.freeze({ docx: "docs.pin.json", xlsx: "sheets.pin.json", pptx: "slides.pin.json", pdf: "pdf.pin.json" });
/** Frame builds known to predate fork G8-12/13 e2dc03bbf, G8-14 f9a5a7742 and G8-15 b6f152ef0 (breakdown §0). */
export const KNOWN_PRE_G812_FRAME_SHAS = Object.freeze(["05fd209", "0d03b18"]);
const PIN_DIR = "apps/web/platform/office-frame";
const DELETED_THREAD_WAIT_MS = 5_000;
/** How long the B7 selection may trail the thread focus before it is read as final. */
const SELECTION_WAIT_MS = 5_000;
/** How long the open panel gets to list a comment created after it opened (focus refresh, fork comments-poll). */
const LISTED_WAIT_MS = 15_000;
const WEB_SHORT_TIMEOUT_MS = 15_000;

/** `{file, gitSha}` of the format's frame pin, or null when the format has no pinned frame. */
export function readFramePin(repoRoot, format) {
  const name = FRAME_PIN_FILE[format];
  if (!name) return null;
  const file = `${PIN_DIR}/${name}`;
  try {
    const pin = JSON.parse(readFileSync(join(repoRoot, file), "utf8"));
    return typeof pin?.gitSha === "string" && pin.gitSha ? { file, gitSha: pin.gitSha } : null;
  } catch {
    return null;
  }
}

/**
 * Whether the pinned frame lacks G8-12..15: a known old sha, or (when the caller
 * can answer it, e.g. from a fork checkout) an ancestry check. An unknown sha is
 * taken as a re-pin and the web sub-steps run and must PASS on their own.
 */
export function framePinVerdict(pin, { containsG812To15 = null } = {}) {
  if (!pin) return { framed: false, old: false, gitSha: null, file: null, blocker: "", owner: "" };
  const known = KNOWN_PRE_G812_FRAME_SHAS.some((sha) => pin.gitSha.startsWith(sha) || sha.startsWith(pin.gitSha));
  const old = known || (typeof containsG812To15 === "function" && !containsG812To15(pin.gitSha));
  return {
    framed: true,
    old,
    gitSha: pin.gitSha,
    file: pin.file,
    blocker: old ? WEB_FRAME_PIN_BLOCKER.replace("05fd209", pin.gitSha) : "",
    owner: old ? WEB_FRAME_PIN_OWNER : "",
  };
}

const frameBlocked = (pin) => Boolean(pin?.framed && pin.old);
const blocked = (pin) => ({ status: "BLOCKED", reason: pin.blocker, blocker: pin.blocker, owner: pin.owner });
const pass = (extra = {}) => ({ status: "PASS", reason: "", ...extra });
const fail = (reason) => ({ status: "FAIL", reason });

/** resource-href.ts:10-12: the notification's workspace when the recipient is in it, else the open one. */
function documentWorkspace(n, workspace, workspaces) {
  return workspaces.find((w) => w.id === n.workspace_id) ?? workspace;
}

/** resource-href.ts:33-44 for a document row; workspaces are `{id, slug, organization_slug}`. */
export function expectedDocumentHref(n, workspace, workspaces) {
  const target = documentWorkspace(n, workspace, workspaces);
  const href = `/${target.organization_slug}/${target.slug}/documents/${n.resource_id}`;
  const commentId = n.params?.comment_id;
  if (!commentId) return href;
  const query = new URLSearchParams({ comment: commentId });
  if (n.params?.kind === "discussion") query.set("kind", "discussion");
  return `${href}?${query.toString()}`;
}

/** The `comment` query of an href (path or absolute URL), or null. */
export function hrefCommentId(href) {
  try {
    return new URL(String(href), "http://x.invalid").searchParams.get("comment") || null;
  } catch {
    return null;
  }
}

/** `{org, ws}` slugs of a `/{org}/{ws}/documents/{id}` href, or null. */
function hrefWorkspace(href) {
  try {
    const parts = new URL(String(href), "http://x.invalid").pathname.split("/").filter(Boolean);
    return parts.length >= 4 && parts[2] === "documents" ? { org: decodeURIComponent(parts[0]), ws: decodeURIComponent(parts[1]) } : null;
  } catch {
    return null;
  }
}

/** desktop-handoff.ts launchCommentId: only an id-shaped value rides the ticket. */
export function launchCommentId(raw) {
  return raw && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : undefined;
}

/** `Sheet!A1` out of a sheets control `selection` reply; `$` and a one-cell `B7:B7` are folded. */
export function normalizeSelection(reply) {
  if (reply?.status !== "ok" || !reply.result?.sheet || !reply.result?.range) return null;
  let range = String(reply.result.range).replaceAll("$", "").toUpperCase();
  const [from, to] = range.split(":");
  if (to && from === to) range = from;
  return `${reply.result.sheet}!${range}`;
}

/** The five UNI-1389 exceptions and what each must show. */
export const DEEP_LINK_EXCEPTIONS = Object.freeze({
  no_access: { web: "B after the revoke: S15 no-access (EXPERIENCE-G8 S15 row 2, document-detail-view.tsx:92-93); C, never given it: the gone page (404)" },
  deleted: { web: "S15 gone (document-detail-view.tsx:108-109)", notification: "resource_deleted, no snippet/document (notification/service.go:238-244)" },
  comment_deleted: { notification: "comment_deleted (notification/service.go:250)", desktop: "the document opens, no thread takes focus", web: "one panel, no thread focused (in-frame: R1)" },
  anchor_lost: { desktop: "the thread opens with the lost label, no jump (use-collab-threads.ts:373-376)", web: "in-frame: R1" },
  session_expired: { web: "the sign-in page" },
});

const hasSnippet = (params) => params && (Object.hasOwn(params, "snippet") || Object.hasOwn(params, "document"));

/** Who answers the launch ticket refused for a deleted comment. */
export const COMMENT_DELETED_LAUNCH_OWNER = "owner candidate Lead D (G8-07 launch ticket, server/internal/service/office_launch.go)";

/** The product reading of a launch refused because its comment_id names a deleted comment. */
export function commentDeletedLaunchReason(launch) {
  return (
    `product: the launch ticket for the deleted comment is refused (POST office/sessions answered ${launch?.status ?? "?"} ${launch?.error ?? ""}`.trimEnd() +
    "); contract-collab.md §2.9 + OQ-C6 drop an unknown comment_id silently and EXPERIENCE-G8.md S15 row 3 opens the document with the panel line, " +
    "but D server/internal/service/office_launch.go:168-188 answers ErrNotFound when the comment is gone (one with no reply is removed for real, " +
    "document_comments.go deleteDocumentCommentOn), so the page's ?comment= (apps/web/platform/office-frame/module-frame-host.tsx:78-79) " +
    `stops "Open in UniWork Office" for the whole document; ${COMMENT_DELETED_LAUNCH_OWNER}`
  );
}

/** One exception's verdict from what was observed; `pin` = framePinVerdict of the fixture's frame. */
export function decideException(name, observed, { pin } = {}) {
  const o = observed ?? null;
  if (o?.notApplicable) return { status: "N/A", reason: o.notApplicable };
  switch (name) {
    case "no_access": {
      const stranger = o?.stranger?.web?.status;
      if (stranger !== "not-found") {
        return fail(`C, who was never given the document, sees ${stranger ?? "nothing"}; want the gone page (the server answers 404 to a non-reader, CLAUDE.md Backend ID Rules)`);
      }
      if (!o?.revoked?.web) return fail("the revoked recipient was not observed (revoke-after did not run)");
      return decideRevokedLink(o.revoked.web, o.revoked.notification);
    }
    case "deleted": {
      if (o?.web?.status !== "not-found") return fail(`the link shows ${o?.web?.status ?? "nothing"}, want S15 gone`);
      if (o?.notification?.resource_deleted !== true) return fail("the row does not read resource_deleted");
      if (hasSnippet(o.notification.params)) return fail("the row still carries snippet/document");
      return pass();
    }
    case "comment_deleted": {
      if (o?.notification?.comment_deleted !== true) return fail("the row does not read comment_deleted");
      if (o.launch?.refused) return fail(commentDeletedLaunchReason(o.launch));
      const dk = o.desktop ?? {};
      if (!dk.openedDocumentId || dk.openedDocumentId !== dk.documentId) return fail("the desktop did not open the document");
      if (dk.focusedThreadId) return fail(`the desktop focused thread ${dk.focusedThreadId} for a deleted comment`);
      if (frameBlocked(pin)) return blocked(pin);
      const w = o.web;
      if (!w || w.panelCount !== 1 || w.focusedCommentId) return fail(`the web page shows ${w?.panelCount ?? 0} panels / focus ${w?.focusedCommentId ?? "none"}, want one panel and no thread`);
      return pass();
    }
    case "anchor_lost": {
      const dk = o?.desktop ?? {};
      if (o?.commentId && o.listedBeforeLaunch === false) {
        return fail(
          `the open panel did not list ${o.commentId} within the bound after a focus refresh, so the launch reveal was not judged ` +
            "(the desktop drops a reveal of an id its panel has not listed: fork apps/sheets/src/renderer/server-comments/SheetsServerComments.tsx:287-289)",
        );
      }
      if (!o?.commentId || dk.focusedThreadId !== o.commentId) {
        return fail(`the desktop did not open the lost-anchor thread (focus ${dk.focusedThreadId ?? "none"})${o?.listedBeforeLaunch ? " although the open panel listed it before the launch" : ""}`);
      }
      if (dk.anchorState !== "lost") return fail(`the thread reads anchor state ${dk.anchorState ?? "none"}, want lost`);
      if (frameBlocked(pin)) return blocked(pin);
      return pass();
    }
    case "session_expired": {
      try {
        return new URL(o?.web?.url).pathname.startsWith("/login") ? pass() : fail(`a signed-out open landed on ${new URL(o.web.url).pathname}`);
      } catch {
        return fail("no signed-out open was observed");
      }
    }
    default:
      return fail(`unknown exception ${name}`);
  }
}

/** Who answers a desktop that drops a launch reveal of a comment its open panel has not listed. */
export const DESKTOP_REVEAL_DROP_OWNER = "owner candidate Lead F (G8-13 Sheets server comments)";

const SHEETS_REVEAL_DROP_CITE = "fork apps/sheets/src/renderer/server-comments/SheetsServerComments.tsx:287-289";
const SHEETS_REVEAL_WAIT_CITE = "SheetsServerComments.tsx:260-286";

/**
 * A reveal that focused no thread. `listedBeforeLaunch === false` (the document was already open and
 * its panel had not listed the comment) on xlsx is the product drop of an unlisted id; anything else
 * stays a plain FAIL that carries what was observed.
 */
function noFocusVerdict(d) {
  const xlsx = d.format === "xlsx";
  if (xlsx && d.listedBeforeLaunch === false) {
    return {
      ...fail(
        `product: the desktop dropped the launch reveal of ${d.commentId}, which its open panel had not listed yet (${SHEETS_REVEAL_DROP_CITE}: ` +
          "a desktop reveal of an unlisted id returns false with no reload and no S15 line); contract-collab.md:663 item 5 sends each launch comment_id one reveal per open " +
          `and EXPERIENCE-G8 S15 row 3 wants the thread or the panel line; ${DESKTOP_REVEAL_DROP_OWNER}`,
      ),
      owner: DESKTOP_REVEAL_DROP_OWNER,
    };
  }
  const evidence = [`the thread is ${d.thread?.present ? "listed" : "not listed"} after the open`];
  if (xlsx) evidence.push(`selection ${normalizeSelection(d.selection) ?? "unknown"}${d.selectionSource ? ` (${d.selectionSource})` : ""}, want ${B7_SHEET_NAME}!${B7_ANCHOR.range}`);
  if (d.listedBeforeLaunch === true) evidence.push("although the open panel listed it before the launch");
  if (xlsx && d.firstOpen && d.commentMadeBeforeLaunch) {
    evidence.push(
      `the comment existed before this first open, so the panel's first list, which the reveal waits for (${SHEETS_REVEAL_WAIT_CITE}), held it: not the unlisted-id drop of ${SHEETS_REVEAL_DROP_CITE}`,
    );
  }
  return fail(`the editor focused ${d.thread?.focusedThreadId ?? "no"} thread, want ${d.commentId}; ${evidence.join("; ")}`);
}

/** Desktop half: the ticket named the comment, the app opened the document, focused the thread, and on xlsx selected B7. */
export function decideDesktopReveal(d) {
  if (!d) return fail("the desktop reveal was not observed");
  if (!d.ticketCommentId || d.ticketCommentId !== d.commentId) return fail(`the launch ticket carried ${d.ticketCommentId ?? "no"} comment id`);
  if (!d.openedDocumentId || d.openedDocumentId !== d.documentId) return fail(`the app opened ${d.openedDocumentId ?? "nothing"}, not the document`);
  if (d.thread?.focusedThreadId !== d.commentId) return noFocusVerdict(d);
  if (d.format === "xlsx") {
    const sel = normalizeSelection(d.selection);
    const want = `${B7_SHEET_NAME}!${B7_ANCHOR.range}`;
    if (sel !== want) return fail(`the selection is ${sel ?? "unknown"}, want ${want}`);
  }
  return pass();
}

/** Who answers a cross-workspace row missing from the recipient's Inbox (the D web Inbox + notifications surface). */
export const CROSS_WORKSPACE_OWNER = "owner candidate g8-collab (D web Inbox / notifications)";

/**
 * G8-A07. `record`: { commentId, documentId, format, framePin, href:{observed, expected},
 * webOpen (openDocument result or null when not attempted), desktop (decideDesktopReveal input),
 * crossWorkspace:{inboxListed, href, expectedHref, opened}, exceptions:{<name>: observed} }.
 */
export function decideG8A07(record) {
  const r = record ?? {};
  const pin = r.framePin ?? framePinVerdict(null);
  const checks = {};

  const obs = r.href?.observed;
  if (!obs) checks["web-href"] = fail("B's Inbox row has no link");
  else if (obs !== r.href.expected) checks["web-href"] = fail(`the Inbox links ${obs}, want ${r.href.expected}`);
  else if (!r.commentId || hrefCommentId(obs) !== r.commentId) checks["web-href"] = fail("the link does not name the comment");
  else checks["web-href"] = pass();

  if (frameBlocked(pin)) checks["web-open"] = blocked(pin);
  else if (r.webOpen?.status !== "ok") checks["web-open"] = fail(`the page shows ${r.webOpen?.status ?? "nothing"}${r.webOpen?.reason ? ` (${r.webOpen.reason})` : ""}`);
  else if (r.webOpen.panelCount !== 1) checks["web-open"] = fail(`the page shows ${r.webOpen.panelCount} comment panels, want 1`);
  else if (r.webOpen.focusedCommentId !== r.commentId) checks["web-open"] = fail(`the page focused ${r.webOpen.focusedCommentId ?? "no"} thread`);
  else checks["web-open"] = pass();

  checks["desktop-reveal"] = decideDesktopReveal(r.desktop ? { commentId: r.commentId, documentId: r.documentId, format: r.format, ...r.desktop } : null);

  const cw = r.crossWorkspace;
  if (!cw) checks["cross-workspace"] = fail("the cross-workspace share was not observed");
  else if (!cw.inboxListed && cw.notificationWorkspaceId && cw.openWorkspaceId && cw.notificationWorkspaceId !== cw.openWorkspaceId) {
    checks["cross-workspace"] = fail(
      `product: the shared document's row is filed under workspace ${cw.notificationWorkspaceId}, which B is not in, and B's Inbox lists only its open workspace ${cw.openWorkspaceId} ` +
        `(D packages/views/notifications/inbox-view.tsx:71 useNotificationPages({workspaceId}) -> server/pkg/db/queries/notifications.sql:37), ` +
        "so the row never reaches resource-href's fall-back (resource-href.ts:10-12); " +
        `AC G8-A07: the slug comes from the recipient workspace list with a fall-back to the open workspace for a direct share from another workspace; ${CROSS_WORKSPACE_OWNER}`,
    );
  } else if (!cw.inboxListed) checks["cross-workspace"] = fail("the shared document's row is not listed in B's Inbox (B's open workspace)");
  else if (cw.href !== cw.expectedHref) checks["cross-workspace"] = fail(`the Inbox links ${cw.href}, want ${cw.expectedHref} (B's workspace)`);
  else if (["no-access", "not-found"].includes(cw.opened?.status)) checks["cross-workspace"] = fail(`the link shows S15 ${cw.opened.status}`);
  else if (frameBlocked(pin)) checks["cross-workspace"] = blocked(pin);
  else if (cw.opened?.status !== "ok" || cw.opened.panelCount !== 1) checks["cross-workspace"] = fail(`the shared document shows ${cw.opened?.status ?? "nothing"}`);
  else checks["cross-workspace"] = pass();

  const ex = {};
  for (const name of Object.keys(DEEP_LINK_EXCEPTIONS)) ex[name] = decideException(name, r.exceptions?.[name], { pin });
  const exVerdict = combineChecks(ex);
  checks.exceptions = { status: exVerdict.status, reason: exVerdict.reason, ...(exVerdict.blocker ? { blocker: exVerdict.blocker, owner: exVerdict.owner } : {}), details: ex };
  return combineChecks(checks);
}

// ---- the flow ----------------------------------------------------------------------------------------

/** Opens `url` in a context with no session (the expired-session case); resolves where it landed. */
export async function openSignedOut(browser, url, { timeoutMs = 30_000 } = {}) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: timeoutMs }).catch(() => {});
    const landed = new URL(page.url());
    return { url: `${landed.origin}${landed.pathname}` };
  } finally {
    await context.close().catch(() => {});
  }
}

/** The sheets control `selection` of the page that shows the document (never the app's first sheets window). */
export function readSelection(ctrl, page) {
  return ctrl.evalBounded(page, () => globalThis.__genofficeControl?.({ cmd: "selection" }) ?? null, undefined, "__genofficeControl.selection");
}

/** Reads the selection until it is `want` or the bound passes (the reveal's cell may trail its thread focus). */
async function settledSelection(ctrl, page, want, d) {
  const opts = pollOpts(d);
  const out = await pollUntil(async () => {
    const reply = await readSelection(ctrl, page);
    return { done: normalizeSelection(reply) === want, reply };
  }, { ...opts, timeoutMs: Math.min(SELECTION_WAIT_MS, opts.timeoutMs ?? SELECTION_WAIT_MS) });
  return out.reply ?? null;
}

/** Focuses the working copy (the panel refreshes on focus) until `commentId`'s thread is listed; true when it is. */
async function listedAfterFocus(ctrl, opened, commentId, d) {
  const opts = pollOpts(d);
  const out = await pollUntil(async () => {
    await ctrl.focus(opened.path);
    const read = await ctrl.evalBounded(opened.page, readThreadInPage, commentId, `read thread ${commentId}`);
    return { done: read?.present === true, present: read?.present === true };
  }, { ...opts, timeoutMs: Math.min(LISTED_WAIT_MS, opts.timeoutMs ?? LISTED_WAIT_MS) });
  return out.present === true;
}

/** The row module (contract §8) for G8-A07. */
export async function runDeeplink(ctx, deps = {}) {
  const d = resolveDeps(ctx, deps);
  const openSignedOutFn = deps.openSignedOut ?? openSignedOut;
  const world = await ctx.getWorld();
  const users = { A: world.user("A"), B: world.user("B"), C: world.user("C") };
  const format = formatOf(ctx.fixture);
  const framePin = framePinVerdict(readFramePin(d.repoRoot, format));
  const org = world.org("X");
  const W2 = world.workspace("X", "W2");
  const w2 = { id: W2.id, slug: W2.slug, organization_slug: org.slug };
  const tag = `${ctx.row}-${Date.now()}`;
  const rec = { format, framePin, exceptions: {} };
  const s = {};
  let ctrl = null;
  let browser = null;
  const webs = [];
  const ok = (step) => step.status === "PASS";
  const openWeb = (page, documentId, comment, extra = {}) =>
    d.web.openDocument(page, { webOrigin: ctx.webOrigin, org: org.slug, ws: W2.slug, documentId, comment, ...extra });
  try {
    if (!ok(await ctx.step("observe-seed", async () => {
      const main = await world.upload("A", "W2", ctx.fixture, { title: `G8-19 A07 ${tag}` });
      await world.share("A", main.documentId, users.B.id, "edit");
      const shared = await world.upload("A", "W1", ctx.fixture, { title: `G8-19 A07 shared ${tag}` });
      const { shareId } = await world.share("A", shared.documentId, users.B.id, "edit");
      // every root kind=comment is anchored (D service/document_comment_anchors.go:262-263):
      // xlsx at sheet 2 B7, docx on the first body paragraph (anchors.mjs anchorForFixture)
      const anchor = commentAnchor(d.repoRoot, ctx.fixture, main.versionId);
      const c1 = await createCommentRest(world, "A", main.documentId, mentionBody(users, tag), anchor);
      const c2 = await createCommentRest(world, "A", shared.documentId, mentionBody(users, `${tag}-shared`), commentAnchor(d.repoRoot, ctx.fixture, shared.versionId));
      Object.assign(s, { main, shared, shareId, c1, c2 });
      rec.documentId = main.documentId;
      rec.commentId = c1;
      return { details: { main: main.documentId, shared: shared.documentId, mainWorkspace: "W2", sharedWorkspace: "W1", anchored: anchor.anchor.format, framePin } };
    }))) return {};

    if (!ok(await ctx.step("observe-notifications", async () => {
      s.rowMain = (await waitForRows(world, "B", s.main.documentId, s.c1, d))[0];
      s.rowShared = (await waitForRows(world, "B", s.shared.documentId, s.c2, d))[0];
      if (!s.rowMain || !s.rowShared) throw new Error(`B got ${s.rowMain ? "" : "no main row "}${s.rowShared ? "" : "no shared row "}within the bound`);
      return { details: { main: s.rowMain.id, shared: s.rowShared.id, sharedWorkspaceId: s.rowShared.workspace_id } };
    }))) return {};

    if (!ok(await ctx.step("observe-web-login", async () => {
      browser = await d.launchBrowser();
      s.webB = await d.web.webLogin(browser, users.B, { webOrigin: ctx.webOrigin, locale: "en" });
      webs.push(s.webB);
      s.webC = await d.web.webLogin(browser, users.C, { webOrigin: ctx.webOrigin, locale: "en" });
      webs.push(s.webC);
    }))) return {};

    await ctx.step("observe-web", async () => {
      const inbox = await d.readInbox(s.webB.page, { webOrigin: ctx.webOrigin, org: org.slug, ws: W2.slug, notificationId: s.rowMain.id });
      rec.href = { observed: inbox.href, expected: expectedDocumentHref(s.rowMain, w2, [w2]) };
      s.inboxMainHref = inbox.href;
      // R1: the in-frame panel is not asked for while the pin is old (it cannot PASS)
      rec.webOpen = frameBlocked(framePin) ? null : await openWeb(s.webB.page, s.main.documentId, s.c1);
      return { details: { listed: inbox.listed, href: inbox.href, webOpen: rec.webOpen?.status ?? (frameBlocked(framePin) ? "skipped (R1)" : null) } };
    });

    if (!ok(await ctx.step("observe-desktop", async () => {
      ctrl = await connectOrFail(ctx, d);
      await signInDesktop(ctrl, world, "B");
      const fromHref = launchCommentId(hrefCommentId(s.inboxMainHref));
      const ticketCommentId = fromHref ?? launchCommentId(s.rowMain.params?.comment_id) ?? null;
      const opened = await openOnDesktop(ctrl, world, "B", s.main.documentId, format, ticketCommentId);
      s.mainOpened = opened;
      const thread = await readThread(ctrl, opened.page, s.c1, d);
      const selection = format === "xlsx" ? await settledSelection(ctrl, opened.page, `${B7_SHEET_NAME}!${B7_ANCHOR.range}`, d) : null;
      rec.desktop = {
        ticketCommentId,
        ticketCommentSource: fromHref ? "inbox-href" : "notification",
        openedDocumentId: opened.openedDocumentId,
        thread,
        selection,
        ...(selection ? { selectionSource: "document page" } : {}),
        // observe-seed uploaded the document and made c1 before this launch, its first open:
        // the panel's first list holds c1, so "listed before the launch" does not apply (null)
        firstOpen: true,
        commentMadeBeforeLaunch: true,
        listedBeforeLaunch: null,
      };
      return { details: { ...rec.desktop } };
    }))) return finishDecisions(ctx, rec);

    await ctx.step("observe-cross-workspace", async () => {
      const inbox = await d.readInbox(s.webB.page, { webOrigin: ctx.webOrigin, org: org.slug, ws: W2.slug, notificationId: s.rowShared.id });
      const at = inbox.href ? hrefWorkspace(inbox.href) : null;
      let opened = null;
      if (inbox.listed && at && !frameBlocked(framePin)) opened = await d.web.openDocument(s.webB.page, { webOrigin: ctx.webOrigin, org: at.org, ws: at.ws, documentId: s.shared.documentId, comment: s.c2 });
      rec.crossWorkspace = { inboxListed: inbox.listed, href: inbox.href, expectedHref: expectedDocumentHref(s.rowShared, w2, [w2]), opened, notificationWorkspaceId: s.rowShared.workspace_id, openWorkspaceId: W2.id };
      return { details: rec.crossWorkspace };
    });

    await ctx.step("observe-no-access", async () => {
      // C (W2 only, never shared) follows a link to the W1 document: the gone page (404, no existence leak);
      // B's S15 no-access half is observed after the revoke (revokeSteps)
      rec.exceptions.no_access = { stranger: { web: await openWeb(s.webC.page, s.shared.documentId, s.c2) } };
      return { details: { web: rec.exceptions.no_access.stranger.web?.status ?? null } };
    });

    await ctx.step("observe-anchor-lost", async () => {
      if (format !== "xlsx") {
        rec.exceptions.anchor_lost = { notApplicable: `${format} carries no B7 anchor; the lost-anchor reveal is checked on xlsx` };
        return { details: rec.exceptions.anchor_lost };
      }
      const c3 = await createCommentRest(world, "A", s.main.documentId, `Neo sẽ mất (G8-19 ${tag})`, commentAnchor(d.repoRoot, ctx.fixture, s.main.versionId));
      const put = await world.session("A").call("putDocumentCommentAnchors", { documentID: s.main.documentId }, { version_id: s.main.versionId, anchors: [{ comment_id: c3, anchor: B7_ANCHOR, state: "lost" }] });
      if (put.status < 200 || put.status >= 300) throw new Error(`PUT anchors answered ${apiErrorText(put)}`);
      // the document is already open: its panel lists c3 only after a refresh, and the desktop drops a reveal
      // of an id it has not listed, so the lost-anchor reveal is judged once the panel lists c3
      const listedBeforeLaunch = await listedAfterFocus(ctrl, s.mainOpened, c3, d);
      const opened = await openOnDesktop(ctrl, world, "B", s.main.documentId, format, c3);
      const thread = await readThread(ctrl, opened.page, c3, d);
      rec.exceptions.anchor_lost = {
        commentId: c3,
        listedBeforeLaunch,
        desktop: { focusedThreadId: thread?.focusedThreadId ?? null, anchorState: thread?.anchorState ?? null },
        put: { status: put.status, skipped: put.body?.skipped ?? null },
      };
      return { details: rec.exceptions.anchor_lost };
    });

    await ctx.step("observe-comment-deleted", async () => {
      const c4 = await createCommentRest(world, "A", s.main.documentId, mentionBody(users, `${tag}-deleted`), commentAnchor(d.repoRoot, ctx.fixture, s.main.versionId));
      await waitForRows(world, "B", s.main.documentId, c4, d);
      const del = await world.session("A").call("deleteDocumentComment", { documentID: s.main.documentId, commentID: c4 });
      if (del.status < 200 || del.status >= 300) throw new Error(`DELETE comment answered ${apiErrorText(del)}`);
      const flagged = await pollUntil(async () => {
        const n = rowsForComment(await notificationsOf(world, "B"), s.main.documentId, c4)[0] ?? null;
        return { done: n?.comment_deleted === true, n };
      }, pollOpts(d));
      // the row flag is recorded before the desktop half, so a refused launch cannot hide it
      rec.exceptions.comment_deleted = { notification: flagged.n ? { comment_deleted: flagged.n.comment_deleted } : null, launch: null, desktop: null, web: null };
      let opened = null;
      try {
        opened = await openOnDesktop(ctrl, world, "B", s.main.documentId, format, c4);
      } catch (err) {
        if (typeof err?.launchStatus !== "number") throw err;
        // the server refused the ticket itself (contract §2.9 wants the comment dropped): a product finding, decided by decideException
        rec.exceptions.comment_deleted.launch = { refused: true, status: err.launchStatus, error: err.launchError ?? "" };
      }
      if (opened) {
        const thread = await readThread(ctrl, opened.page, c4, d, { timeoutMs: Math.min(DELETED_THREAD_WAIT_MS, d.pollTimeoutMs ?? DELETED_THREAD_WAIT_MS) });
        rec.exceptions.comment_deleted.launch = { refused: false };
        rec.exceptions.comment_deleted.desktop = { openedDocumentId: opened.openedDocumentId, documentId: s.main.documentId, focusedThreadId: thread?.focusedThreadId ?? null };
      }
      rec.exceptions.comment_deleted.web = frameBlocked(framePin) ? null : await openWeb(s.webB.page, s.main.documentId, c4, { timeoutMs: WEB_SHORT_TIMEOUT_MS });
      return { details: rec.exceptions.comment_deleted };
    });

    await ctx.step("observe-session-expired", async () => {
      const url = new URL(`${expectedDocumentHref(s.rowMain, w2, [w2])}`, ctx.webOrigin).toString();
      rec.exceptions.session_expired = { web: await openSignedOutFn(browser, url) };
      return { details: rec.exceptions.session_expired };
    });

    // revoke mid-session on the shared document (B has it open on both hosts), then archive the main one
    const sharedOpen = await ctx.step("observe-open-shared", async () => {
      s.sharedOpened = await openOnDesktop(ctrl, world, "B", s.shared.documentId, format);
      return { details: { openedDocumentId: s.sharedOpened.openedDocumentId } };
    });
    if (ok(sharedOpen)) {
      const revoked = await revokeSteps(ctx, {
        world,
        d,
        ctrl,
        webPage: s.webB.page,
        shared: { documentId: s.shared.documentId, shareId: s.shareId, commentId: s.c2, path: s.sharedOpened.path, page: s.sharedOpened.page },
        archive: { documentId: s.main.documentId, commentId: s.c1 },
      });
      if (revoked.after?.web) rec.exceptions.no_access = { ...rec.exceptions.no_access, revoked: { web: revoked.after.web, notification: revoked.after.notification } };
      if (revoked.archive) rec.exceptions.deleted = { web: revoked.archive.web, notification: revoked.archive.notification };
    }
    return finishDecisions(ctx, rec);
  } finally {
    await closeAll(...webs, browser, ctrl);
  }
}

/** Records one step per decideG8A07 check (web-href, web-open, desktop-reveal, cross-workspace, exceptions). */
async function finishDecisions(ctx, rec) {
  const verdict = decideG8A07(rec);
  for (const [name, check] of Object.entries(verdict.checks)) await ctx.step(name, async () => verdictStep({ ...check, checks: check.details ?? undefined }));
  return { details: { a07: { documentId: rec.documentId, commentId: rec.commentId, framePin: rec.framePin } } };
}

if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("deeplink", (ctx) => runDeeplink(ctx)));
