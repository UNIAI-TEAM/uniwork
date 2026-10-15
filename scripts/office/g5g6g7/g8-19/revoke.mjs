// G8-19 (UNI-1414) row module "revoke": the G8-A07 clauses "quyền kiểm lúc
// mở" and "snippet ẩn khi mất quyền".
//
// A shares a W1 document directly with B (a W2-only member), mentions B, and
// B opens it on the desktop and on the web. A revokes the share mid-session:
// - the desktop panel's next list is refused (`forbidden` / `permission_revoked`
//   / `not_found`: fork apps/shell/src/main/uniwork-docs/errors.ts:130,142-143);
// - B's REST list answers 403/404 (D server/internal/handler/router/documents.go:316);
// - B's deep link renders the S15 no-access state (D packages/views/documents/document-detail-view.tsx:92-93,
//   packages/views/documents/document-inbox-state.tsx:31);
// - B's notification keeps its link but loses `snippet`/`document` and reads
//   `resource_access_lost: true` (D server/internal/notification/service.go:91,245-247;
//   server/internal/service/document_access.go:388-411).
// Archiving a document B still reads answers `resource_deleted: true`, the
// same snippet removal (service.go:238-244) and the S15 gone state (document-detail-view.tsx:108-109).
//
// deeplink.mjs runs these steps inside its G8-A07 run (revokeSteps), so the
// cloud spec needs no separate revoke line; this CLI reruns them alone.
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
  resolveDeps,
  rowsForComment,
  signInDesktop,
  verdictStep,
  waitForRows,
} from "./inbox.mjs";
import { rowMain } from "./run-row.mjs";

export const LOCKED_DESKTOP_CODES = Object.freeze(["forbidden", "permission_revoked", "not_found"]);
/** The desktop polls every 30 s or on focus (fork packages/electron-utils/src/comments-poll.ts:14); the harness focuses and waits at most this. */
export const DESKTOP_LOCK_TIMEOUT_MS = 35_000;
const WEB_BEFORE_TIMEOUT_MS = 15_000;

const pass = () => ({ status: "PASS", reason: "" });
const fail = (reason) => ({ status: "FAIL", reason });
const hasSnippet = (params) => params && (Object.hasOwn(params, "snippet") || Object.hasOwn(params, "document"));

/**
 * `record`: { before:{desktop (CommentsReply), web, notification},
 * after:{desktop (CommentsReply), rest:{status}, web:{status}, notification},
 * archive:{notification, web:{status}} }.
 */
export function decideRevoke(record) {
  const r = record ?? {};
  const checks = {};
  const b = r.before ?? {};
  if (!b.desktop?.ok) checks.before = fail(`B's desktop panel did not list before the revoke (${b.desktop?.error?.code ?? "no reply"})`);
  else if (!b.notification?.params?.snippet) checks.before = fail("B's row had no snippet before the revoke, so hiding it proves nothing");
  else checks.before = pass();

  const a = r.after ?? {};
  const code = a.desktop?.error?.code;
  if (a.desktop?.ok !== false) checks["desktop-locked"] = fail("the desktop panel still lists after the revoke");
  else if (!LOCKED_DESKTOP_CODES.includes(code)) checks["desktop-locked"] = fail(`the desktop list failed with ${code ?? "no code"}, not a permission verdict`);
  else checks["desktop-locked"] = pass();
  checks["rest-locked"] = [403, 404].includes(a.rest?.status) ? pass() : fail(`B's REST list answered ${a.rest?.status ?? "nothing"} after the revoke`);
  checks["web-no-access"] = a.web?.status === "no-access" ? pass() : fail(`B's deep link shows ${a.web?.status ?? "nothing"}, want the S15 no-access state`);
  const n = a.notification;
  if (!n) checks["snippet-hidden"] = fail("B's row is gone after the revoke; it should stay with the snippet hidden");
  else if (n.resource_access_lost !== true) checks["snippet-hidden"] = fail("B's row does not read resource_access_lost");
  else if (hasSnippet(n.params)) checks["snippet-hidden"] = fail("B's row still carries snippet/document after the revoke");
  else checks["snippet-hidden"] = pass();

  const ar = r.archive;
  if (!ar) checks.archive = fail("the archive step did not run");
  else if (ar.notification?.resource_deleted !== true) checks.archive = fail("the archived document's row does not read resource_deleted");
  else if (hasSnippet(ar.notification.params)) checks.archive = fail("the archived document's row still carries snippet/document");
  else if (ar.web?.status !== "not-found") checks.archive = fail(`the archived document's deep link shows ${ar.web?.status ?? "nothing"}, want the S15 gone state`);
  else checks.archive = pass();
  return combineChecks(checks);
}

const openWeb = (d, ctx, page, world, documentId, commentId, timeoutMs) =>
  d.web.openDocument(page, {
    webOrigin: ctx.webOrigin,
    org: world.org("X").slug,
    // B is in W2 only: resource-href opens a shared document in the open workspace
    ws: world.workspace("X", "W2").slug,
    documentId,
    comment: commentId,
    ...(timeoutMs ? { timeoutMs } : {}),
  });

/**
 * The revoke and archive steps on an already-open session. `env`:
 * { world, d, ctrl, webPage, shared:{documentId, shareId, commentId, path, page}, archive:{documentId, commentId} }.
 * Records steps revoke-before / revoke-act / revoke-after / archive and the decision step "revoke";
 * resolves the record (deeplink.mjs reuses its web and archive parts as exceptions).
 */
export async function revokeSteps(ctx, { world, d, ctrl, webPage, shared, archive }) {
  const rec = { before: {}, after: {}, archive: null };
  const bridge = ctrl.comments(shared.page);
  const ok = (s) => s.status === "PASS";
  const before = await ctx.step("revoke-before", async () => {
    rec.before.notification = (await waitForRows(world, "B", shared.documentId, shared.commentId, d))[0] ?? null;
    rec.before.desktop = await bridge.list({ path: shared.path, kind: "comment" });
    rec.before.web = await openWeb(d, ctx, webPage, world, shared.documentId, shared.commentId, WEB_BEFORE_TIMEOUT_MS);
    return { details: { desktopOk: rec.before.desktop?.ok ?? false, web: rec.before.web?.status ?? null, notified: Boolean(rec.before.notification) } };
  });
  const act = ok(before) && (await ctx.step("revoke-act", async () => ({ details: await world.revokeShare("A", shared.documentId, shared.shareId) })));
  if (act && ok(act)) {
    await ctx.step("revoke-after", async () => {
      const locked = await pollUntil(async () => {
        await ctrl.focus(shared.path);
        const reply = await bridge.list({ path: shared.path, kind: "comment" });
        return { done: reply?.ok === false, reply };
      }, { ...pollOpts(d), timeoutMs: d.lockTimeoutMs ?? DESKTOP_LOCK_TIMEOUT_MS });
      rec.after.desktop = locked.reply;
      rec.after.rest = { status: (await world.session("B").call("listDocumentComments", { documentID: shared.documentId })).status };
      rec.after.web = await openWeb(d, ctx, webPage, world, shared.documentId, shared.commentId);
      rec.after.notification = (await notificationsOf(world, "B")).find((n) => n.id === rec.before.notification?.id) ?? null;
      return { details: { desktop: rec.after.desktop?.ok ? "listing" : rec.after.desktop?.error?.code ?? null, rest: rec.after.rest.status, web: rec.after.web?.status ?? null } };
    });
  }
  if (archive) {
    await ctx.step("archive", async () => {
      const row = (await waitForRows(world, "B", archive.documentId, archive.commentId, d))[0] ?? null;
      if (!row) throw new Error("B got no row on the document to archive");
      const res = await world.session("A").call("archiveDocument", { documentID: archive.documentId });
      if (res.status < 200 || res.status >= 300) throw new Error(`archive answered ${apiErrorText(res)}`);
      const gone = await pollUntil(async () => {
        const n = rowsForComment(await notificationsOf(world, "B"), archive.documentId, archive.commentId)[0] ?? null;
        return { done: n?.resource_deleted === true, n };
      }, pollOpts(d));
      rec.archive = { notification: gone.n, web: await openWeb(d, ctx, webPage, world, archive.documentId, archive.commentId) };
      return { details: { resourceDeleted: gone.n?.resource_deleted ?? null, web: rec.archive.web?.status ?? null } };
    });
  }
  await ctx.step("revoke", async () => verdictStep(decideRevoke(rec)));
  return rec;
}

/** Standalone CLI flow: seed a W1 document shared to B plus a W2 one to archive, open both hosts as B, run revokeSteps. */
export async function runRevoke(ctx, deps = {}) {
  const d = resolveDeps(ctx, deps);
  const world = await ctx.getWorld();
  const users = { A: world.user("A"), B: world.user("B") };
  const format = formatOf(ctx.fixture);
  const tag = `${ctx.row}-revoke-${Date.now()}`;
  let ctrl = null;
  let browser = null;
  let web = null;
  try {
    const seeded = {};
    const seed = await ctx.step("seed", async () => {
      const shared = await world.upload("A", "W1", ctx.fixture, { title: `G8-19 revoke ${tag}` });
      const { shareId } = await world.share("A", shared.documentId, users.B.id, "edit");
      const commentId = await createCommentRest(world, "A", shared.documentId, mentionBody(users, tag), commentAnchor(d.repoRoot, ctx.fixture, shared.versionId));
      const toArchive = await world.upload("A", "W2", ctx.fixture, { title: `G8-19 archive ${tag}` });
      const archiveCommentId = await createCommentRest(world, "A", toArchive.documentId, mentionBody(users, `${tag}-archive`), commentAnchor(d.repoRoot, ctx.fixture, toArchive.versionId));
      Object.assign(seeded, { shared: { documentId: shared.documentId, shareId, commentId }, archive: { documentId: toArchive.documentId, commentId: archiveCommentId } });
      return { details: { shared: shared.documentId, archive: toArchive.documentId } };
    });
    if (seed.status !== "PASS") return {};
    const open = await ctx.step("open-both-hosts", async () => {
      ctrl = await connectOrFail(ctx, d);
      await signInDesktop(ctrl, world, "B");
      const opened = await openOnDesktop(ctrl, world, "B", seeded.shared.documentId, format);
      Object.assign(seeded.shared, { path: opened.path, page: opened.page });
      browser = await d.launchBrowser();
      web = await d.web.webLogin(browser, world.user("B"), { webOrigin: ctx.webOrigin, locale: "en" });
      return { details: { kind: opened.kind, openedDocumentId: opened.openedDocumentId } };
    });
    if (open.status !== "PASS") return {};
    await revokeSteps(ctx, { world, d, ctrl, webPage: web.page, shared: seeded.shared, archive: seeded.archive });
    return {};
  } finally {
    await closeAll(web, browser, ctrl);
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("revoke", (ctx) => runRevoke(ctx)));
