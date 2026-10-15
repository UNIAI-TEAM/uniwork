// G8-19 (UNI-1414) row module "inbox": G8-A05 and G8-A06.
//
// G8-A05 "mention theo id, body một định dạng giữa hai host": A opens a W1
// document shared to B only (C sits in W2 and never reads it) in the desktop
// app, asks the desktop mention picker for B and C, and writes a body that
// names B twice and A once through `window.uniworkComments.create`. B gets
// exactly one `document_mentioned` row, A and C none, and the body the web
// client reads over REST equals the desktop body byte for byte.
//
// G8-A06 "Inbox đúng bảng UNI-1337": on a W2 document, a plain comment
// notifies nobody, a mention notifies B and never its author; B's web Inbox
// row shows the en title, then the vi title after the locale cookie flips;
// B marks it read, A's count does not move and A cannot mark B's row.
//
// Surfaces (D = this repo, F = fork 7d665a54):
// - mention token: D server/internal/mentions/mentions.go:21-24
// - mention rule (readers only, never the token's author, one row per comment
//   via the group key): D server/internal/notification/rules.go:455-489 (params :464, one claimed row per token :488)
// - picker: D server/internal/handler/router/documents.go:398
//   (GET /documents/{id}/mention-candidates); F packages/electron-utils/src/comments-ipc.ts:91-94,160
// - desktop create/list: F packages/electron-utils/src/comments-ipc.ts:68-75,152-153
//   (the main process forwards the API bodies unchanged, comments-ipc.ts:8-12)
// - web body: D packages/core/api/endpoints/document-comments.ts (GET /documents/{id}/comments)
// - Inbox: D server/internal/handler/router/notifications.go:24 (list), :38 (read);
//   row markup packages/views/notifications/notification-row.tsx:128,150 (li[data-notification-id], a[data-row-focus]);
//   title key + _untitled packages/views/notifications/notification-title.tsx:38-41;
//   templates packages/core/i18n/locales/en.json:4776-4777, vi.json:4772-4773
// - read per person: D server/internal/handler/dto/sdi/notification.go:5 (someone else's id answers 404)
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEV_CLIENT_ID, HARNESS_DEPLOYMENT_ID, isMainModule } from "../harness/lib.mjs";
import { connectApp as realConnectApp, editorKindOfFormat, editorKindOfUrl } from "../harness/app.mjs";
import { loadPlaywrightChromium } from "../harness/app-steps.mjs";
import * as realWeb from "../harness/web.mjs";
import { apiErrorText } from "../harness/api.mjs";
import { anchorForFixture } from "./anchors.mjs";
import { rowMain } from "./run-row.mjs";

export const DEFAULT_POLL_MS = 500;
export const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const INBOX_TIMEOUT_MS = 30_000;
const PARAM_MARK = "\u2063"; // notification-title.tsx:10 brackets each param with it

// ---- pure helpers ---------------------------------------------------------------------------------

/** The editor's mention token `[@Label](mention://member/<id>)`; `[`, `]` and `\` in the label are escaped. */
export function mentionToken(label, userId) {
  return `[@${String(label).replace(/[[\]\\]/g, "\\$&")}](mention://member/${userId})`;
}

/** B twice (duplicates must still notify once) and the author A once (no self-mention). */
export function mentionBody(users, runTag) {
  const b = mentionToken(users.B.displayName, users.B.id);
  const a = mentionToken(users.A.displayName, users.A.id);
  return `Nhờ ${b} xem giúp số liệu quý 2, ${b} nhé; cc ${a} (G8-19 ${runTag})`;
}

/** The document rows of one comment. */
export function rowsForComment(rows, documentId, commentId) {
  return (rows ?? []).filter((n) => n?.resource_type === "document" && n.resource_id === documentId && n.params?.comment_id === commentId);
}

export function loadLocale(repoRoot, lang) {
  return JSON.parse(readFileSync(join(repoRoot, "packages/core/i18n/locales", `${lang}.json`), "utf8"));
}

/** notification-title.tsx notificationTitleKey: a document row without its title snapshot uses `_untitled`. */
export function titleKeyFor(n) {
  const key = n?.title_key || `notifications.kind.${n?.kind}`;
  const untitled = n?.resource_type === "document" && key.startsWith("notifications.kind.document_");
  return untitled && !String(n?.params?.document ?? "").trim() ? `${key}_untitled` : key;
}

/** The sentence the row renders in `locale` (the parsed locale JSON), or null when the key is unknown. */
export function expectedTitle(locale, n) {
  const template = titleKeyFor(n)
    .split(".")
    .reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), locale);
  if (typeof template !== "string") return null;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => String(n?.params?.[k] ?? ""));
}

/** Row text as read: no param markers, whitespace collapsed. */
export function normalizeRowText(text) {
  return String(text ?? "")
    .replaceAll(PARAM_MARK, "")
    .replace(/\s+/g, " ")
    .trim();
}

const idsOf = (list) => (Array.isArray(list) ? list.map((c) => c?.user_id).filter(Boolean) : []);
/** user ids out of a mention-candidates body or a desktop searchMentions reply value. */
export function candidateIds(body) {
  return idsOf(body?.candidates);
}

const pass = (extra = {}) => ({ status: "PASS", reason: "", ...extra });
const fail = (reason, extra = {}) => ({ status: "FAIL", reason, ...extra });

/** Folds named checks: any FAIL -> FAIL; any BLOCKED -> BLOCKED with the blockers; N/A ignored; else PASS. */
export function combineChecks(checks) {
  const entries = Object.entries(checks);
  const failed = entries.filter(([, c]) => c.status === "FAIL");
  if (failed.length) return { status: "FAIL", reason: failed.map(([k, c]) => `${k}: ${c.reason}`).join("; "), blocker: "", owner: "", checks };
  const blocked = entries.filter(([, c]) => c.status === "BLOCKED");
  if (blocked.length) {
    return {
      status: "BLOCKED",
      reason: blocked.map(([k, c]) => `${k}: ${c.blocker}`).join("; "),
      blocker: [...new Set(blocked.map(([, c]) => c.blocker))].join("; "),
      owner: [...new Set(blocked.map(([, c]) => c.owner).filter(Boolean))].join(", "),
      checks,
    };
  }
  if (!entries.some(([, c]) => c.status === "PASS")) return { status: "FAIL", reason: "no check ran", blocker: "", owner: "", checks };
  return { status: "PASS", reason: "", blocker: "", owner: "", checks };
}

/** A combined verdict as a ctx.step result: status, reason, blocker/owner, and the checks under details. */
export function verdictStep(verdict, details = {}) {
  const out = { status: verdict.status, reason: verdict.reason ?? "", details: { checks: verdict.checks, ...details } };
  if (verdict.blocker) out.blocker = verdict.blocker;
  if (verdict.owner) out.owner = verdict.owner;
  return out;
}

// ---- decisions --------------------------------------------------------------------------------------

/**
 * G8-A05. `record`: { users:{A,B,C} (ids), documentId, commentId, sentBody,
 * created:{ok, commentId, error?}, candidates:{desktopB, desktopC (replies with ids), rest:{status, ids}},
 * notifications:{A,B,C} (full rows), bodies:{desktop, web} }.
 */
export function decideG8A05(record) {
  const r = record ?? {};
  const u = r.users ?? {};
  const checks = {};
  checks.create = r.created?.ok && r.created.commentId && r.created.commentId === r.commentId
    ? pass()
    : fail(`desktop create did not return the comment (${r.created?.error?.code ?? "no reply"})`);

  const c = r.candidates ?? {};
  const pickerProblems = [];
  if (!c.desktopB?.ok) pickerProblems.push(`desktop search for B failed (${c.desktopB?.error?.code ?? "no reply"})`);
  else if (!c.desktopB.ids?.includes(u.B)) pickerProblems.push("desktop picker does not offer B");
  if (!c.desktopC?.ok) pickerProblems.push(`desktop search for C failed (${c.desktopC?.error?.code ?? "no reply"})`);
  else if (c.desktopC.ids?.includes(u.C)) pickerProblems.push("desktop picker offers the non-reader C");
  if (c.rest?.status !== 200) pickerProblems.push(`mention-candidates answered ${c.rest?.status ?? "nothing"}`);
  else {
    if (!c.rest.ids?.includes(u.B)) pickerProblems.push("mention-candidates does not list B");
    if (c.rest.ids?.includes(u.C)) pickerProblems.push("mention-candidates lists the non-reader C");
  }
  checks.picker = pickerProblems.length ? fail(pickerProblems.join("; ")) : pass();

  const n = r.notifications ?? {};
  const bRows = rowsForComment(n.B, r.documentId, r.commentId);
  if (!u.B || !r.commentId) checks.recipient = fail("no comment or recipient to check");
  else if (bRows.length !== 1) checks.recipient = fail(`B has ${bRows.length} rows for the comment, want exactly 1`);
  else if (bRows[0].kind !== "document_mentioned") checks.recipient = fail(`B's row is ${bRows[0].kind}, want document_mentioned`);
  else if (Number(bRows[0].count ?? 1) !== 1) checks.recipient = fail(`B's row merged ${bRows[0].count} events, want 1`);
  else checks.recipient = pass({ notificationId: bRows[0].id });

  const aRows = rowsForComment(n.A, r.documentId, r.commentId);
  checks.self = !Array.isArray(n.A) ? fail("A's notifications were not read") : aRows.length ? fail(`A (the author) has ${aRows.length} rows for a self-mention`) : pass();
  const cRows = rowsForComment(n.C, r.documentId, r.commentId);
  checks["non-reader"] = !Array.isArray(n.C) ? fail("C's notifications were not read") : cRows.length ? fail(`the non-reader C has ${cRows.length} rows`) : pass();

  const b = r.bodies ?? {};
  if (typeof b.desktop !== "string" || typeof b.web !== "string") checks.body = fail("a host did not return the comment body");
  else if (b.desktop !== b.web) checks.body = fail("desktop and web bodies differ");
  else if (r.sentBody !== undefined && b.web !== r.sentBody) checks.body = fail("the stored body differs from the body sent");
  else checks.body = pass();
  return combineChecks(checks);
}

/**
 * G8-A06. `record`: { notification (B's mention row), plainRows (B's rows for a
 * plain comment), selfRows (A's rows for the mention), titles:{en,vi}:{rowText, expected},
 * read:{markStatus, foreignStatus, rowReadAt, bBefore, bAfter, aBefore, aAfter} }.
 */
export function decideG8A06(record) {
  const r = record ?? {};
  const checks = {};
  checks.notified = r.notification?.kind === "document_mentioned" ? pass() : fail("B has no document_mentioned row");
  checks["plain-silent"] = Array.isArray(r.plainRows) ? (r.plainRows.length ? fail(`a plain comment notified B (${r.plainRows.length} rows)`) : pass()) : fail("plain comment rows not read");
  checks["not-self"] = Array.isArray(r.selfRows) ? (r.selfRows.length ? fail(`the author got ${r.selfRows.length} rows`) : pass()) : fail("author rows not read");

  for (const lang of ["en", "vi"]) {
    const t = r.titles?.[lang];
    if (!t?.expected) checks[`title-${lang}`] = fail(`no ${lang} template for the row`);
    else if (!normalizeRowText(t.rowText).includes(normalizeRowText(t.expected))) checks[`title-${lang}`] = fail(`the ${lang} row does not show "${t.expected}"`);
    else checks[`title-${lang}`] = pass();
  }
  if (checks["title-en"].status === "PASS" && checks["title-vi"].status === "PASS" && normalizeRowText(r.titles.en.expected) === normalizeRowText(r.titles.vi.expected)) {
    checks["title-vi"] = fail("vi and en titles are the same text");
  }

  const rd = r.read ?? {};
  const readProblems = [];
  if (!(rd.markStatus >= 200 && rd.markStatus < 300)) readProblems.push(`B's mark read answered ${rd.markStatus}`);
  if (rd.foreignStatus !== 404) readProblems.push(`A marking B's row answered ${rd.foreignStatus}, want 404`);
  if (!rd.rowReadAt) readProblems.push("B's row has no read_at after marking");
  if (!(Number.isFinite(rd.bBefore) && rd.bAfter === rd.bBefore - 1)) readProblems.push(`B's unread went ${rd.bBefore} -> ${rd.bAfter}, want -1`);
  if (!(Number.isFinite(rd.aBefore) && rd.aAfter === rd.aBefore)) readProblems.push(`A's unread moved ${rd.aBefore} -> ${rd.aAfter}`);
  checks["read-per-person"] = readProblems.length ? fail(readProblems.join("; ")) : pass();
  return combineChecks(checks);
}

// ---- flow helpers (shared with deeplink.mjs and revoke.mjs) ------------------------------------------

/** Polls `fn` until it answers `{done:true, ...}` or the bound passes (`timedOut:true`). */
export async function pollUntil(fn, { timeoutMs = DEFAULT_POLL_TIMEOUT_MS, intervalMs = DEFAULT_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const last = await fn();
    if (last?.done) return last;
    if (Date.now() >= deadline) return { ...last, timedOut: true };
    await sleep(intervalMs);
  }
}

export function pollOpts(deps) {
  return { timeoutMs: deps.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS, intervalMs: deps.pollMs ?? DEFAULT_POLL_MS, sleep: deps.sleep };
}

/** A user's notification rows (GET /me/notifications); throws on a non-200 (an app failure). */
export async function notificationsOf(world, userKey) {
  const res = await world.session(userKey).call("listNotifications");
  if (res.status !== 200) throw new Error(`GET /me/notifications as ${userKey} answered ${apiErrorText(res)}`);
  return res.body?.notifications ?? [];
}

/** Waits for `userKey`'s rows naming the comment (the outbox consumer is asynchronous). */
export async function waitForRows(world, userKey, documentId, commentId, deps) {
  const out = await pollUntil(async () => {
    const rows = rowsForComment(await notificationsOf(world, userKey), documentId, commentId);
    return { done: rows.length > 0, rows };
  }, pollOpts(deps));
  return out.rows;
}

export async function unreadTotal(world, userKey) {
  const res = await world.session(userKey).call("unreadNotificationCount");
  if (res.status !== 200) throw new Error(`unread-count as ${userKey} answered ${apiErrorText(res)}`);
  return Number(res.body?.total);
}

/**
 * The anchor half of a root kind=comment for `fixture`: the anchor the desktop
 * editor writes (anchors.mjs anchorForFixture, the A01 plan) on `versionId`.
 * D refuses a root kind=comment without both (service/document_comment_anchors.go:262-263).
 */
export function commentAnchor(repoRoot, fixture, versionId) {
  if (!versionId) throw new Error("commentAnchor: the document's version id is required (base_version_id)");
  return { anchor: anchorForFixture(fixture, { repoRoot, pdfPage: 1 }), base_version_id: versionId };
}

/**
 * Creates a root kind=comment over REST as `userKey`; resolves the comment id.
 * `anchored` is `commentAnchor(...)`: an anchorless root comment is a 400 on D,
 * so it is refused here as a harness error before any request.
 */
export async function createCommentRest(world, userKey, documentId, body, anchored) {
  if (!anchored?.anchor || !anchored?.base_version_id) throw new Error("createCommentRest: a root kind=comment needs anchor + base_version_id (commentAnchor)");
  const res = await world.session(userKey).call("createDocumentComment", { documentID: documentId }, { body, kind: "comment", anchor: anchored.anchor, base_version_id: anchored.base_version_id });
  const id = res.body?.comment?.id;
  if (res.status < 200 || res.status >= 300 || !id) throw new Error(`POST comments as ${userKey} answered ${apiErrorText(res)}`);
  return id;
}

/** Mints the launch ticket the "Mở trong UniWork Office" button mints (D packages/core/office/desktop-handoff.ts:27-36). */
export async function mintLaunchUrl(world, userKey, documentId, commentId) {
  const body = { operation: "edit", deployment_id: HARNESS_DEPLOYMENT_ID, client_id: DEV_CLIENT_ID, return_hint: "office" };
  if (commentId) body.comment_id = commentId;
  const res = await world.session(userKey).call("mintLaunch", { documentID: documentId }, body);
  const url = res.body?.launch_url;
  if (res.status < 200 || res.status >= 300 || !url) throw new Error(`office/sessions as ${userKey} answered ${apiErrorText(res)}`);
  return url;
}

/** connectApp, with every way of not getting an app turned into a FAIL reason (a harness/app failure, never BLOCKED). */
export async function connectOrFail(ctx, deps) {
  const connect = deps.connectApp ?? realConnectApp;
  try {
    return await connect({ portsEnv: ctx.portsEnv, runDir: ctx.runDir });
  } catch (err) {
    throw new Error(`the desktop app cannot be driven: ${err?.appUnavailable?.reason ?? err?.message ?? err}`);
  }
}

/** Signs `userKey` in on the desktop; throws unless the account reads signed in. */
export async function signInDesktop(ctrl, world, userKey) {
  const out = await ctrl.signIn(world.user(userKey));
  if (out?.status?.loggedIn === false) throw new Error(`desktop sign-in as ${userKey} did not complete (${out?.status?.state ?? "unknown"})`);
  return { state: out?.status?.state ?? null };
}

/** Opens `documentId` in the app as the signed-in user through a fresh launch ticket; the editor page of its format. */
export async function openOnDesktop(ctrl, world, userKey, documentId, format, commentId = null) {
  const launchUrl = await mintLaunchUrl(world, userKey, documentId, commentId);
  const opened = await ctrl.openByTicket(launchUrl, { documentId });
  const kind = editorKindOfFormat(format);
  if (!kind) throw new Error(`no editor kind for format ${format}`);
  const page = await editorPageFor(ctrl, kind, opened?.path ?? null);
  return { path: opened?.path ?? null, openedDocumentId: opened?.documentId ?? null, kind, page };
}

/**
 * The editor page that shows `path`. With two documents of one kind open,
 * `ctrl.editorPage(kind)` may answer the other tab, and the comments bridge
 * refuses a path the sender does not show (fork apps/shell/src/main/uniwork-docs/comments-wiring.ts:241-246),
 * so every page of the kind is asked `uniworkComments.context({path})` and the one that answers ok wins.
 */
export async function editorPageFor(ctrl, kind, path) {
  const first = await ctrl.editorPage(kind);
  if (!path || typeof ctrl.browser?.contexts !== "function") return first;
  const pages = ctrl.browser.contexts().flatMap((c) => c.pages()).filter((p) => editorKindOfUrl(p.url()) === kind);
  for (const p of pages) {
    const reply = await ctrl.comments(p).context({ path }).catch(() => null);
    if (reply?.ok) return p;
  }
  return first;
}

/** Runs in the editor page: the thread of `id` and which thread holds focus (fork packages/ui/src/collab/CollabThread.tsx:857-870, use-collab-threads.ts:373-376). */
export function readThreadInPage(id) {
  const esc = (v) => (globalThis.CSS?.escape ? globalThis.CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&"));
  const el = document.querySelector(`[data-thread-id="${esc(id)}"]`);
  const active = document.activeElement?.closest?.("[data-thread-id]")?.getAttribute("data-thread-id") ?? null;
  const heading = el?.querySelector(".collab-th");
  const m = heading ? /collab-th--([a-z]+)/.exec(heading.className) : null;
  return { present: Boolean(el), focusedThreadId: active, anchorState: m ? m[1] : null };
}

/** Polls the editor until `commentId`'s thread holds focus (a reveal is asynchronous) or the bound passes. */
export async function readThread(ctrl, page, commentId, deps, { timeoutMs } = {}) {
  const opts = pollOpts(deps);
  const out = await pollUntil(async () => {
    const read = (await ctrl.evalBounded(page, readThreadInPage, commentId, `read thread ${commentId}`)) ?? { present: false, focusedThreadId: null, anchorState: null };
    return { done: read.focusedThreadId === commentId, read };
  }, { ...opts, timeoutMs: timeoutMs ?? opts.timeoutMs });
  return out.read;
}

/** Runs in the D Inbox page: one row's link and text (notification-row.tsx:128,150). */
function readInboxRowInPage(id) {
  const li = document.querySelector(`li[data-notification-id="${String(id).replace(/["\\]/g, "\\$&")}"]`);
  if (!li) return null;
  return { href: li.querySelector("a[data-row-focus]")?.getAttribute("href") ?? null, text: li.textContent ?? "" };
}

/** Opens `/{org}/{ws}/inbox` and waits for the row; `{listed, href (path + query), text}`. */
export async function readInbox(page, { webOrigin, org, ws, notificationId, timeoutMs = INBOX_TIMEOUT_MS, pollMs = DEFAULT_POLL_MS }) {
  await page.goto(new URL(`/${encodeURIComponent(org)}/${encodeURIComponent(ws)}/inbox`, webOrigin).toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const out = await pollUntil(async () => {
    const row = await page.evaluate(readInboxRowInPage, notificationId).catch(() => null);
    return { done: Boolean(row), row };
  }, { timeoutMs, intervalMs: pollMs });
  if (!out.row) return { listed: false, href: null, text: "" };
  const href = out.row.href ? (() => {
    const u = new URL(out.row.href, webOrigin);
    return `${u.pathname}${u.search}`;
  })() : null;
  return { listed: true, href, text: out.row.text };
}

export async function launchBrowser(repoRoot) {
  const chromium = loadPlaywrightChromium(repoRoot);
  if (!chromium) throw new Error("Playwright chromium is not loadable from e2e/node_modules");
  return chromium.launch({ headless: true });
}

/** The real drivers unless a test injects fakes. */
export function resolveDeps(ctx, deps = {}) {
  return {
    web: deps.web ?? realWeb,
    connectApp: deps.connectApp ?? realConnectApp,
    launchBrowser: deps.launchBrowser ?? (() => launchBrowser(ctx.repoRoot)),
    readInbox: deps.readInbox ?? readInbox,
    sleep: deps.sleep,
    pollMs: deps.pollMs,
    pollTimeoutMs: deps.pollTimeoutMs,
    repoRoot: deps.repoRoot ?? ctx.repoRoot,
    ...deps,
  };
}

/** Closes whatever the flow opened; never throws. */
export async function closeAll(...things) {
  for (const t of things) {
    try {
      await t?.close?.();
    } catch {
      /* best effort */
    }
  }
}

export function formatOf(fixture) {
  const m = /^fx-([a-z]+)-/.exec(String(fixture));
  return m ? m[1] : null;
}

// ---- the row flows ----------------------------------------------------------------------------------

async function runA05(ctx, d) {
  const world = await ctx.getWorld();
  const users = { A: world.user("A"), B: world.user("B"), C: world.user("C") };
  const format = formatOf(ctx.fixture);
  const tag = `${ctx.row}-${Date.now()}`;
  const rec = { users: { A: users.A.id, B: users.B.id, C: users.C.id }, candidates: {}, notifications: {}, bodies: {} };
  let ctrl = null;
  try {
    let doc;
    const seed = await ctx.step("seed", async () => {
      doc = await world.upload("A", "W1", ctx.fixture, { title: `G8-19 A05 ${tag}` });
      await world.share("A", doc.documentId, users.B.id, "view");
      rec.documentId = doc.documentId;
      return { details: { documentId: doc.documentId, workspace: "W1", sharedTo: "B" } };
    });
    if (seed.status !== "PASS") return {};

    let opened;
    const open = await ctx.step("desktop-open", async () => {
      ctrl = await connectOrFail(ctx, d);
      const signIn = await signInDesktop(ctrl, world, "A");
      opened = await openOnDesktop(ctrl, world, "A", doc.documentId, format);
      if (opened.openedDocumentId && opened.openedDocumentId !== doc.documentId) throw new Error(`the app opened ${opened.openedDocumentId}, not the document`);
      return { details: { signIn, kind: opened.kind, openedDocumentId: opened.openedDocumentId } };
    });
    if (open.status !== "PASS") return {};
    const bridge = ctrl.comments(opened.page);

    await ctx.step("picker", async () => {
      const b = await bridge.searchMentions({ path: opened.path, q: users.B.displayName, limit: 20 });
      const c = await bridge.searchMentions({ path: opened.path, q: users.C.displayName, limit: 20 });
      const rest = await world.session("A").call("listMentionCandidates", { documentID: doc.documentId }, undefined, { query: { limit: 50 } });
      rec.candidates = {
        desktopB: b?.ok ? { ok: true, ids: candidateIds(b.value) } : { ok: false, error: b?.error ?? null },
        desktopC: c?.ok ? { ok: true, ids: candidateIds(c.value) } : { ok: false, error: c?.error ?? null },
        rest: { status: rest.status, ids: candidateIds(rest.body) },
      };
      return { details: rec.candidates };
    });

    rec.sentBody = mentionBody(users, tag);
    const created = await ctx.step("desktop-create", async () => {
      // a root kind=comment carries the fixture's anchor on the uploaded version, as A01's
      // desktop create does; without it the bridge answers malformed (fork comments-ipc.ts:270-276)
      const reply = await bridge.create({ path: opened.path, kind: "comment", body: rec.sentBody, anchor: anchorForFixture(ctx.fixture, { repoRoot: d.repoRoot, pdfPage: 1 }), baseVersionId: doc.versionId });
      rec.created = reply?.ok ? { ok: true, commentId: reply.value?.comment?.id ?? null } : { ok: false, error: reply?.error ?? null };
      rec.commentId = rec.created.commentId ?? null;
      if (!rec.created.ok) throw new Error(`uniworkComments.create failed (${rec.created.error?.code ?? "no reply"})`);
      return { details: { commentId: rec.commentId } };
    });
    if (created.status !== "PASS") return {};

    await ctx.step("notifications", async () => {
      rec.notifications.B = await waitForRows(world, "B", doc.documentId, rec.commentId, d);
      // B's row is the consumer's mark: A's and C's would have been written in the same pass
      rec.notifications.A = rowsForComment(await notificationsOf(world, "A"), doc.documentId, rec.commentId);
      rec.notifications.C = rowsForComment(await notificationsOf(world, "C"), doc.documentId, rec.commentId);
      return { details: { B: rec.notifications.B.length, A: rec.notifications.A.length, C: rec.notifications.C.length } };
    });

    await ctx.step("bodies", async () => {
      const list = await bridge.list({ path: opened.path, kind: "comment" });
      rec.bodies.desktop = list?.ok ? (list.value?.comments ?? []).find((c) => c.id === rec.commentId)?.body ?? null : null;
      const rest = await world.session("B").call("listDocumentComments", { documentID: doc.documentId }, undefined, { query: { kind: "comment" } });
      rec.bodies.web = rest.status === 200 ? (rest.body?.comments ?? []).find((c) => c.id === rec.commentId)?.body ?? null : null;
      return { details: { desktopListed: rec.bodies.desktop !== null, webStatus: rest.status } };
    });

    await ctx.step("decide-G8-A05", async () => verdictStep(decideG8A05(rec)));
    return { details: { a05: { documentId: rec.documentId, commentId: rec.commentId } } };
  } finally {
    await closeAll(ctrl);
  }
}

async function runA06(ctx, d) {
  const world = await ctx.getWorld();
  const users = { A: world.user("A"), B: world.user("B") };
  const org = world.org("X");
  const w2 = world.workspace("X", "W2");
  const tag = `${ctx.row}-${Date.now()}`;
  const rec = { titles: {}, read: {} };
  let browser = null;
  let web = null;
  try {
    let doc;
    const seed = await ctx.step("seed", async () => {
      doc = await world.upload("A", "W2", ctx.fixture, { title: `G8-19 A06 ${tag}` });
      return { details: { documentId: doc.documentId, workspace: "W2" } };
    });
    if (seed.status !== "PASS") return {};

    let plainId;
    let mentionId;
    const comments = await ctx.step("comments", async () => {
      const anchored = commentAnchor(d.repoRoot, ctx.fixture, doc.versionId);
      plainId = await createCommentRest(world, "A", doc.documentId, `Ghi chú không nhắc ai (G8-19 ${tag})`, anchored);
      mentionId = await createCommentRest(world, "A", doc.documentId, mentionBody(users, tag), anchored);
      return { details: { plainId, mentionId } };
    });
    if (comments.status !== "PASS") return {};

    const rows = await ctx.step("notifications", async () => {
      // the mention, created after the plain comment, is the sentinel: once B
      // has it, the consumer has passed the plain comment too
      const bRows = await waitForRows(world, "B", doc.documentId, mentionId, d);
      rec.notification = bRows[0] ?? null;
      const bAll = await notificationsOf(world, "B");
      rec.plainRows = rowsForComment(bAll, doc.documentId, plainId);
      rec.selfRows = rowsForComment(await notificationsOf(world, "A"), doc.documentId, mentionId);
      if (!rec.notification) throw new Error("B got no row for the mention within the bound");
      return { details: { notificationId: rec.notification.id, plain: rec.plainRows.length, self: rec.selfRows.length } };
    });
    if (rows.status !== "PASS") return {};

    await ctx.step("web-titles", async () => {
      const en = loadLocale(d.repoRoot, "en");
      const vi = loadLocale(d.repoRoot, "vi");
      browser = await d.launchBrowser();
      web = await d.web.webLogin(browser, world.user("B"), { webOrigin: ctx.webOrigin, locale: "en" });
      const at = { webOrigin: ctx.webOrigin, org: org.slug, ws: w2.slug, notificationId: rec.notification.id };
      const enRead = await d.readInbox(web.page, at);
      await web.setLocale("vi");
      const viRead = await d.readInbox(web.page, at);
      rec.titles = {
        en: { rowText: normalizeRowText(enRead.text), expected: expectedTitle(en, rec.notification), listed: enRead.listed },
        vi: { rowText: normalizeRowText(viRead.text), expected: expectedTitle(vi, rec.notification), listed: viRead.listed },
      };
      return { details: { listed: { en: enRead.listed, vi: viRead.listed } } };
    });

    await ctx.step("read-state", async () => {
      rec.read.bBefore = await unreadTotal(world, "B");
      rec.read.aBefore = await unreadTotal(world, "A");
      rec.read.foreignStatus = (await world.session("A").call("markNotificationsRead", {}, { ids: [rec.notification.id] })).status;
      rec.read.markStatus = (await world.session("B").call("markNotificationsRead", {}, { ids: [rec.notification.id] })).status;
      rec.read.bAfter = await unreadTotal(world, "B");
      rec.read.aAfter = await unreadTotal(world, "A");
      rec.read.rowReadAt = (await notificationsOf(world, "B")).find((n) => n.id === rec.notification.id)?.read_at ?? null;
      return { details: { ...rec.read } };
    });

    await ctx.step("decide-G8-A06", async () => verdictStep(decideG8A06(rec), { titles: rec.titles }));
    return {};
  } finally {
    await closeAll(web, browser);
  }
}

/** The row module (contract §8): G8-A05 or G8-A06. */
export async function runInbox(ctx, deps = {}) {
  const d = resolveDeps(ctx, deps);
  if (ctx.row === "G8-A05") return runA05(ctx, d);
  if (ctx.row === "G8-A06") return runA06(ctx, d);
  return { status: "FAIL", reason: `inbox.mjs runs G8-A05 and G8-A06, not ${ctx.row}` };
}

if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("inbox", (ctx) => runInbox(ctx)));
