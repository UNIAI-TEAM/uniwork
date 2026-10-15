// G8-19 (UNI-1414) row module for comments across hosts:
//   node scripts/office/g5g6g7/g8-19/comments.mjs --row G8-A01|G8-A04 --fixture <fx> --run-dir <dir>
// G8-A01: desktop A creates an anchored comment in the fixture's editor, makes a
// small edit through a product command and Saves; the Save must make a new server
// version, the comment is exactly one server row authored by A (human), the second
// user reads it, and neither the bytes of that new version, the working copy nor
// any payload carries the machine's account name.
// "AI only proposes" is cited from the fork vitest of G8-12..15 (lead decision
// Q2: AI_PROVIDER=fake turns the AI off on the runner).
// G8-A04: one data set for two hosts. The desktop has no push: it sees a web
// change on focus or on its 30 s poll (fork packages/electron-utils/src/comments-poll.ts:6-14),
// so the harness forces focus and bounds the wait at 35 s. The web panel inside
// an Office frame needs the G8-12..15 frame: BLOCKED(R1) while the pin is old.
// The G8-A03 rename/copy add-on runs inside A04 and is reported in its artifact.
import { readFile as fsReadFile } from "node:fs/promises";

import { API_PREFIX } from "../harness/api-contract.mjs";
import { connectApp as realConnectApp } from "../harness/app.mjs";
import { loadPlaywrightChromium, sleep as realSleep } from "../harness/app-steps.mjs";
import { isMainModule, setAppApiProxyOnline } from "../harness/lib.mjs";
import { openDocument, webLogin } from "../harness/web.mjs";
import {
  EDIT_DRIVERS,
  FIXTURE_FORMAT,
  anchorForFixture,
  forkAncestorChecker,
  framePinBlock,
  openCommentsPanel,
  openOnDesktop,
  pollUntil,
  readFramePin,
  readServer,
  runEditPlan,
  saveOnDesktop,
  unwrap,
} from "./anchors.mjs";
import { machineNames, scanForNames, scanText } from "./file-scan.mjs";
import { decideFromSteps, rowMain } from "./run-row.mjs";

/** Lead decision Q2: the A01 "AI only proposes, the human who presses Send is the author" evidence. */
export const AI_CLAUSE = Object.freeze({
  covered_by: "fork-vitest G8-12..15",
  why: "AI_PROVIDER=fake turns the AI off for every org on the runner (docs/office/g5g6g7/contract-p0.md §8); the fork adapter vitest of G8-12..15 proves the AI tool never calls comments.create before Send (docs/office/g5g6g7/contract-collab.md §12, A01 command)",
});

/** The desktop poll interval (fork comments-poll.ts:14, 30 s) plus 5 s for the focus round trip. */
export const A04_DESKTOP_BOUND_MS = 35_000;
const DESKTOP_PROBE_INTERVAL_MS = 2_500;

const isOk = (status) => status >= 200 && status < 300;
const check = (reasons) => (reasons.length === 0 ? { status: "PASS" } : { status: "FAIL", reason: reasons.join("; ") });
const hitList = (hits) => hits.map((h) => `${h.part}@${h.offset}`).join(", ");

/**
 * The A01 dirtying edit per format (lead decision r1b): a product command, so the
 * Save has something to store. Reuses the A02 plans (EDIT_DRIVERS); the moved
 * anchor does not matter to A01, which checks the row, the author and the bytes.
 */
export const DIRTY_EDITS = Object.freeze({
  docx: { plan: EDIT_DRIVERS.docx.shift, cites: EDIT_DRIVERS.docx.cites },
  xlsx: { plan: EDIT_DRIVERS.xlsx.shift, cites: EDIT_DRIVERS.xlsx.cites },
  pptx: { plan: EDIT_DRIVERS.pptx.shift, cites: EDIT_DRIVERS.pptx.cites },
  pdf: {
    // one Insert blank page after page 1: the page-1 anchor stays on page 1
    plan: EDIT_DRIVERS.pdf.prepare.slice(0, 3),
    cites: EDIT_DRIVERS.pdf.cites,
    why:
      "not an annotation: in a document bound to the server the Note tool makes a server thread, not a file note " +
      "(fork apps/pdf/src/renderer/App.tsx:1558,1712), and highlight/ink need a pointer drag on the page canvas; " +
      "Insert blank page is the product command the A02 plan already drives",
  },
});

/** GET the bytes of version `version` of a file document as the bearer of `token` (router/documents.go:198, ?version=N). */
export async function downloadVersion({ apiOrigin, token, documentId, version, fetchImpl = fetch, timeoutMs = 60_000 }) {
  const url = `${apiOrigin}${API_PREFIX}/documents/${encodeURIComponent(documentId)}/download?version=${encodeURIComponent(String(version))}`;
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`download of version ${version} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The document head: `{ versionId, version }` from getDocument; throws on a non-2xx. */
async function readHead(session, documentId) {
  const doc = await session.call("getDocument", { documentID: documentId });
  if (!doc.ok) throw new Error(`getDocument answered ${doc.status}`);
  const file = doc.body?.document?.file ?? {};
  return { versionId: file.version_id ?? null, version: file.version ?? null };
}

// ---- in-page probes (evaluated through ctrl.evalBounded; self-contained) -----------------

/**
 * What the desktop comments panel shows: `aside.collab-panel` (fork
 * packages/ui/src/collab/CollabPanel.tsx:526-528), its `[data-comment-id]`
 * comments (CollabThread.tsx:712), the warn status line `.collab-pnote--warn`
 * (offline / server error, CollabPanel.tsx:163-180,560), the composer textarea
 * (CollabComposer.tsx:319-324) and Send's aria-disabled (:381-382).
 */
export function panelProbe() {
  const panels = document.querySelectorAll("aside.collab-panel");
  const panel = panels[0] ?? null;
  const textarea = panel?.querySelector("textarea.collab-composer-input") ?? null;
  const send = panel?.querySelector(".collab-composer-send") ?? null;
  return {
    panels: panels.length,
    commentIds: panel ? [...panel.querySelectorAll("[data-comment-id]")].map((el) => el.getAttribute("data-comment-id")) : [],
    warn: panel ? panel.querySelector(".collab-pnote--warn") !== null : false,
    composer: textarea !== null,
    draft: textarea ? textarea.value : null,
    sendDisabled: send ? send.getAttribute("aria-disabled") === "true" || send.disabled === true : null,
  };
}

/** Types `text` into the panel composer the way React sees input (native setter + input event). */
export function typeDraft({ text }) {
  const textarea = document.querySelector("aside.collab-panel textarea.collab-composer-input");
  if (!textarea) return { ok: false, reason: "no composer textarea in the panel" };
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, text);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: true };
}

/**
 * Forces the desktop poll (ctrl.focus, contract §7) and probes until `pred`
 * holds or A04_DESKTOP_BOUND_MS passes. Resolves `{ seen, elapsedMs, focusForced, value }`;
 * `focusForced` is false if any focus reached no editor page.
 */
export async function waitDesktopSees({ ctrl, path, probe, pred, boundMs = A04_DESKTOP_BOUND_MS, intervalMs = DESKTOP_PROBE_INTERVAL_MS, sleep = realSleep, now = Date.now }) {
  let focusForced = true;
  const res = await pollUntil(
    async () => {
      const f = await ctrl.focus(path);
      if (!f || f.pages === 0 || f.activated === false) focusForced = false;
      return probe();
    },
    (value) => Boolean(pred(value)),
    { boundMs, intervalMs, sleep, now },
  );
  return { seen: res.ok, elapsedMs: res.elapsedMs, focusForced, value: res.value };
}

// ---- G8-A01 ----------------------------------------------------------------------------------

/** G8-A01 (pure): the checks and the row status; `aiOnlyProposes` is the cited clause (Q2). */
export function decideG8A01(rec) {
  const steps = {};
  const create = rec.create ?? {};
  steps["check:create"] = check(create.ok && create.commentId ? [] : [`the desktop create failed: ${create.error ?? "no comment id"}`]);
  const rows = (rec.rows ?? []).filter((r) => r.body === rec.marker);
  const row = rows[0] ?? null;
  steps["check:one-row"] = check([
    ...(rows.length === 1 ? [] : [`${rows.length} rows carry the body of one create`]),
    ...(row && create.commentId && row.id !== create.commentId ? [`the row is ${row.id}, the create answered ${create.commentId}`] : []),
  ]);
  steps["check:author"] = check(
    !row ? ["no row"] : [...(row.author_id === rec.userId ? [] : [`author_id ${row.author_id}, want ${rec.userId}`]), ...(row.author_kind === "human" ? [] : [`author_kind ${row.author_kind}, want human`])],
  );
  steps["check:anchor-format"] = check(row?.anchor?.format === rec.format ? [] : [`anchor format ${row?.anchor?.format ?? "none"}, want ${rec.format}`]);
  steps["check:web-sees-row"] = check((rec.webRows ?? []).some((r) => r.id === create.commentId) ? [] : ["user B does not read the row"]);
  steps["check:dirty-edit"] = check(rec.dirtyEdit?.status === "ok" ? [] : [`the edit before Save failed: ${rec.dirtyEdit?.reason ?? "did not run"}`]);
  const after = rec.versionAfter;
  steps["check:new-version"] = check(
    rec.saved && after?.versionId && after.versionId !== rec.versionBefore ? [] : [`the Save made no new server version (head ${after?.versionId ?? "unread"})`],
  );
  const scan = rec.scan;
  const local = rec.localScan;
  steps["check:file-scan"] = check(
    !rec.saved
      ? ["Save failed, so there is no saved file to scan"]
      : [
          ...(!scan ? ["the bytes of the new server version were not scanned"] : []),
          ...(!local ? ["the working copy was not scanned"] : []),
          ...(scan && !scan.names?.length ? ["no machine name left to scan for (all skipped)"] : []),
          ...(scan?.hits?.length ? [`machine name in ${hitList(scan.hits)}`] : []),
          ...(local?.hits?.length ? [`machine name in the working copy: ${hitList(local.hits)}`] : []),
        ],
  );
  steps["check:payload-scan"] = check(rec.payloadHits?.length ? [`machine name in ${hitList(rec.payloadHits)}`] : []);
  return { ...decideFromSteps(steps), steps, aiOnlyProposes: AI_CLAUSE };
}

/**
 * Runs G8-A01 on one editor fixture. `deps`: connectApp, readFile, machine (machineNames()),
 * download (`{documentId, version, userKey}` -> bytes), sleep, now.
 */
export async function runG8A01(ctx, deps = {}) {
  const { connectApp = realConnectApp, readFile = fsReadFile, machine = machineNames(), sleep = realSleep, now = Date.now } = deps;
  const format = FIXTURE_FORMAT[ctx.fixture];
  if (!format) return { status: "FAIL", reason: `G8-A01 has no editor for fixture ${ctx.fixture}` };
  const rec = { format, fixture: ctx.fixture, marker: `G8-A01 ${ctx.fixture} ${Date.now().toString(36)}`, aiOnlyProposes: AI_CLAUSE, machine: { names: machine.names, skipped: machine.skipped } };
  const out = (extra) => ({ ...extra, details: rec });
  let desk = null;
  try {
    const world = await ctx.getWorld();
    const A = world.session("A");
    const B = world.session("B");
    rec.userId = world.user("A").id;
    let doc;
    let s = await ctx.step("upload", async () => {
      doc = await world.upload("A", "W2", ctx.fixture, { title: `G8-A01 ${ctx.fixture}` });
      rec.documentId = doc.documentId;
    });
    if (s.status !== "PASS") return out({ status: "FAIL", reason: `upload: ${s.reason}` });
    s = await ctx.step("open-desktop", async () => {
      desk = await openOnDesktop({ ctx, world, connectApp, documentId: doc.documentId, format });
    });
    if (s.status !== "PASS") return out({ status: "FAIL", reason: `open-desktop: ${s.reason}` });

    const payloads = [];
    await ctx.step("create", async () => {
      const contextReply = await desk.comments.context({ path: desk.path });
      payloads.push(["payload:context", contextReply]);
      const context = unwrap(contextReply, "comments.context");
      const anchor = anchorForFixture(ctx.fixture, { repoRoot: ctx.repoRoot, pdfPage: 1 });
      const reply = await desk.comments.create({ path: desk.path, kind: "comment", body: rec.marker, anchor, baseVersionId: context.versionId });
      payloads.push(["payload:create", reply]);
      rec.create = reply?.ok ? { ok: true, commentId: reply.value?.comment?.id ?? null } : { ok: false, error: reply?.error?.code ?? "no reply" };
      if (!reply?.ok) return { status: "FAIL", reason: `comments.create -> ${rec.create.error}` };
      return {};
    });
    const download =
      deps.download ??
      (({ documentId, version, userKey }) => downloadVersion({ apiOrigin: ctx.apiOrigin, token: world.user(userKey).token, documentId, version }));
    await ctx.step("dirty-edit", async () => {
      rec.dirtyEdit = await runEditPlan(desk.ctrl, desk.page, DIRTY_EDITS[format].plan);
      rec.dirtyEditCites = DIRTY_EDITS[format].cites;
      if (DIRTY_EDITS[format].why) rec.dirtyEditWhy = DIRTY_EDITS[format].why;
      return rec.dirtyEdit.status === "ok" ? {} : { status: "FAIL", reason: rec.dirtyEdit.reason };
    });
    await ctx.step("save", async () => {
      rec.saved = false;
      rec.versionBefore = (await readHead(A, doc.documentId)).versionId;
      await saveOnDesktop(desk.ctrl, desk.path);
      rec.saved = true;
      const settled = await pollUntil(
        () => readHead(A, doc.documentId),
        (h) => Boolean(h.versionId && h.versionId !== rec.versionBefore),
        { boundMs: 60_000, intervalMs: 1_000, sleep, now },
      );
      rec.versionAfter = settled.value;
      return settled.ok ? {} : { status: "FAIL", reason: `no new server version within ${settled.elapsedMs} ms (head ${settled.value?.versionId})` };
    });
    await ctx.step("server-rows", async () => {
      const server = await readServer(A, doc.documentId);
      rec.rows = server.comments;
      payloads.push(["payload:list", server.comments]);
      rec.webRows = (await readServer(B, doc.documentId)).comments.filter((r) => r.id === rec.create?.commentId).map((r) => ({ id: r.id }));
    });
    await ctx.step("scan", async () => {
      if (rec.saved) rec.localScan = scanForNames(await readFile(desk.path), machine.names);
      const after = rec.versionAfter;
      if (rec.saved && after?.versionId && after.versionId !== rec.versionBefore && after.version !== null) {
        rec.scan = scanForNames(await download({ documentId: doc.documentId, version: after.version, userKey: "A" }), machine.names);
      }
      rec.payloadHits = payloads.flatMap(([part, value]) => scanText(JSON.stringify(value ?? null), rec.scan?.names ?? machine.names, part));
    });
    return out(decideG8A01(rec));
  } catch (err) {
    return out({ status: "FAIL", reason: err instanceof Error ? err.message : String(err) });
  } finally {
    if (desk?.ctrl) await Promise.resolve(desk.ctrl.close?.()).catch(() => {});
  }
}

// ---- G8-A04 ------------------------------------------------------------------------------------

function passThrough(part, fallbackReason) {
  if (!part) return { status: "FAIL", reason: fallbackReason };
  return { status: part.status, ...(part.reason ? { reason: part.reason } : {}), ...(part.blocker ? { blocker: part.blocker, owner: part.owner ?? "" } : {}) };
}

/** G8-A04 (pure). FAIL beats BLOCKED(R1) beats PASS. */
export function decideG8A04(rec) {
  const steps = {};
  const bound = A04_DESKTOP_BOUND_MS;
  const w = rec.webToDesktop ?? {};
  steps["check:web-to-desktop"] = check([
    ...(w.created ? [] : ["the web create failed"]),
    ...(w.seen ? [] : [`the desktop did not show the web comment within ${w.elapsedMs ?? "?"} ms`]),
    ...(w.seen && !(w.elapsedMs <= bound) ? [`seen after ${w.elapsedMs} ms, over the ${bound} ms bound`] : []),
    ...(w.focusForced ? [] : ["the desktop focus reached no editor page, so the poll was not forced"]),
  ]);
  const d = rec.desktopToWebRest ?? {};
  steps["check:desktop-to-web-rest"] = check([...(d.created ? [] : ["the desktop create failed"]), ...(d.seen ? [] : ["user B does not read the desktop comment"])]);
  const rt = rec.desktopToWebRealtime;
  steps["check:desktop-to-web-realtime"] =
    rt?.status === "BLOCKED" || rt?.status === "FAIL" || rt?.status === "PASS"
      ? passThrough(rt)
      : check(rt?.seenWithoutReload ? [] : ["the open web page did not show the desktop comment without a reload"]);
  const muts = rec.mutations ?? [];
  steps["check:mutations"] = check([
    ...(muts.length >= 5 ? [] : [`${muts.length} mutations ran, want edit/resolve/reopen from desktop and edit/resolve from web`]),
    ...muts.filter((m) => !m.ok || !m.seen).map((m) => `${m.from} ${m.op}: ${m.ok ? "not seen on the other host" : `failed${m.reason ? ` (${m.reason})` : ""}`}`),
    ...muts.filter((m) => m.from === "web" && m.seen && !(m.elapsedMs <= bound)).map((m) => `web ${m.op} seen on desktop after ${m.elapsedMs} ms`),
  ]);
  const h = rec.hardDelete ?? {};
  steps["check:hard-delete"] = check([
    ...(h.deleted ? [] : ["the web hard delete failed"]),
    ...(h.tokenChanged ? [] : ["list_token did not change after the hard delete"]),
    ...(h.goneOnDesktop ? [] : ["the deleted thread is still on the desktop after the poll"]),
  ]);
  const c = rec.concurrent ?? {};
  steps["check:concurrent"] = check([
    ...((c.statuses ?? []).length === 2 && c.statuses.every(isOk) ? [] : [`concurrent sends answered ${(c.statuses ?? []).join(", ") || "nothing"}`]),
    ...(new Set(c.ids ?? []).size === 2 ? [] : ["the two sends did not get two ids"]),
    ...(c.rows === 2 ? [] : [`${c.rows ?? 0} rows for two concurrent sends`]),
  ]);
  const o = rec.offline ?? {};
  steps["check:offline"] = check([
    ...(o.draftTyped ? [] : ["no draft could be typed into the composer"]),
    ...(o.readOnly ? [] : ["no offline status line while the server was unreachable"]),
    ...(o.sendBlocked ? [] : ["Send was not blocked offline"]),
    ...(o.draftKept ? [] : ["the draft was lost offline"]),
    ...(o.recovered ? [] : ["the panel did not recover when the server came back"]),
    ...(o.draftKeptAfter ? [] : ["the draft was lost after recovery"]),
  ]);
  const p = rec.panels ?? {};
  steps["check:one-panel-desktop"] = check(p.desktop === 1 ? [] : [`${p.desktop ?? 0} comment panels on the desktop editor`]);
  steps["check:one-panel-web"] =
    p.web && typeof p.web === "object" && p.web.status !== "PASS" ? passThrough(p.web) : check((p.web?.count ?? p.web) === 1 ? [] : [`${p.web?.count ?? p.web ?? 0} comment panels on the web page`]);
  return { ...decideFromSteps(steps), steps };
}

/** The G8-A03 add-on (pure): one discussion kept across a rename, none on a copy. */
export function decideA03AddOn(rec) {
  const reasons = [];
  const ids = rec?.afterRename?.ids ?? [];
  if (!rec?.discussionId) reasons.push("no discussion was created");
  if (ids.length !== 1 || ids[0] !== rec?.discussionId) reasons.push(`after the rename the document lists discussions [${ids.join(", ")}], want [${rec?.discussionId}]`);
  if (!rec?.afterRename?.titleChanged) reasons.push("the rename from the app did not reach the server");
  if (rec?.copy?.comments !== 0) reasons.push(`the copy carries ${rec?.copy?.comments ?? "?"} comments, want 0`);
  return reasons.length === 0 ? { status: "PASS", reason: "" } : { status: "FAIL", reason: reasons.join("; ") };
}

/** Desktop and web panel, web realtime: the open web page shows a desktop comment without a reload. */
async function webLiveCheck({ ctx, world, documentId, createOnDesktop, launchBrowser }) {
  const browser = await launchBrowser();
  try {
    const web = await webLogin(browser, world.user("B"), { webOrigin: ctx.webOrigin });
    const opened = await openDocument(web.page, { webOrigin: ctx.webOrigin, org: world.org("X").slug, ws: world.workspace("X", "W2").slug, documentId });
    const id = await createOnDesktop();
    const seen = await web.page
      .waitForSelector(`[data-testid="document-thread-${id}"]`, { timeout: A04_DESKTOP_BOUND_MS })
      .then(() => true)
      .catch(() => false);
    return { realtime: { seenWithoutReload: seen }, panel: { status: "PASS", count: opened.panelCount } };
  } finally {
    await Promise.race([Promise.resolve().then(() => browser.close()).catch(() => {}), realSleep(2_000)]);
  }
}

/**
 * Runs G8-A04 on one fixture. `deps`: connectApp, sleep, now, framePin,
 * isAncestor, setOnline (setAppApiProxyOnline), launchBrowser.
 */
export async function runG8A04(ctx, deps = {}) {
  const { connectApp = realConnectApp, sleep = realSleep, now = Date.now, setOnline = setAppApiProxyOnline } = deps;
  const launchBrowser = deps.launchBrowser ?? (() => loadPlaywrightChromium(ctx.repoRoot).launch({ headless: true }));
  const format = FIXTURE_FORMAT[ctx.fixture];
  if (!format) return { status: "FAIL", reason: `G8-A04 has no editor for fixture ${ctx.fixture}` };
  const tag = `${ctx.fixture} ${Date.now().toString(36)}`;
  const rec = { format, fixture: ctx.fixture, mutations: [] };
  const out = (extra) => ({ ...extra, details: rec });
  const waitOpts = { sleep, now };
  let desk = null;
  let wentOffline = false;
  try {
    const world = await ctx.getWorld();
    const A = world.session("A");
    const B = world.session("B");
    let doc;
    let s = await ctx.step("upload", async () => {
      doc = await world.upload("A", "W2", ctx.fixture, { title: `G8-A04 ${ctx.fixture}` });
      rec.documentId = doc.documentId;
    });
    if (s.status !== "PASS") return out({ status: "FAIL", reason: `upload: ${s.reason}` });
    s = await ctx.step("open-desktop", async () => {
      desk = await openOnDesktop({ ctx, world, connectApp, documentId: doc.documentId, format });
    });
    if (s.status !== "PASS") return out({ status: "FAIL", reason: `open-desktop: ${s.reason}` });

    const probe = () => desk.ctrl.evalBounded(desk.page, panelProbe, {}, "probe:panel");
    const listDesk = async (sinceToken) => unwrap(await desk.comments.list({ path: desk.path, kind: "comment", ...(sinceToken ? { sinceToken } : {}) }), "comments.list");
    const listB = async () => (await readServer(B, doc.documentId)).comments;
    const anchor = anchorForFixture(ctx.fixture, { repoRoot: ctx.repoRoot, pdfPage: 1 });
    let versionId = null;

    s = await ctx.step("panel", async () => {
      versionId = unwrap(await desk.comments.context({ path: desk.path }), "comments.context").versionId;
      // the editor's own control (anchors.mjs PANEL_OPENERS: Review > Show Comments in docs/sheets)
      const opened = await openCommentsPanel({ ctrl: desk.ctrl, page: desk.page, format, probe, sleep, now });
      rec.panels = { desktop: opened.panels, opened: opened.opened };
      if (opened.status !== "ok") throw new Error(`open the comments panel: ${opened.reason}`);
    });
    if (s.status !== "PASS") return out({ status: "FAIL", reason: `panel: ${s.reason}` });

    const webCreate = (body) => B.call("createDocumentComment", { documentID: doc.documentId }, { kind: "comment", body, anchor, base_version_id: versionId });
    let webId = null;
    await ctx.step("web-to-desktop", async () => {
      const res = await webCreate(`G8-A04 web ${tag}`);
      webId = res.body?.comment?.id ?? null;
      rec.webToDesktop = { created: isOk(res.status) && Boolean(webId), seen: false };
      if (!rec.webToDesktop.created) return { status: "FAIL", reason: `createDocumentComment answered ${res.status}` };
      const seen = await waitDesktopSees({ ctrl: desk.ctrl, path: desk.path, probe, pred: (v) => v?.commentIds?.includes(webId), ...waitOpts });
      Object.assign(rec.webToDesktop, { seen: seen.seen, elapsedMs: seen.elapsedMs, focusForced: seen.focusForced });
      return {};
    });

    let deskId = null;
    const createOnDesktop = async () => {
      const c = unwrap(await desk.comments.create({ path: desk.path, kind: "comment", body: `G8-A04 desktop ${tag}`, anchor, baseVersionId: versionId }), "comments.create").comment;
      deskId = c.id;
      return c.id;
    };
    const block = framePinBlock(deps.framePin ?? readFramePin(ctx.repoRoot, format), { isAncestor: deps.isAncestor ?? forkAncestorChecker(process.env, ctx.portsEnv) });
    await ctx.step("desktop-to-web", async () => {
      if (block) {
        await createOnDesktop();
        rec.desktopToWebRealtime = block;
        rec.panels.web = block;
      } else {
        const live = await webLiveCheck({ ctx, world, documentId: doc.documentId, createOnDesktop, launchBrowser });
        rec.desktopToWebRealtime = live.realtime;
        rec.panels.web = live.panel;
      }
      rec.desktopToWebRest = { created: Boolean(deskId), seen: (await listB()).some((r) => r.id === deskId) };
    });

    await ctx.step("mutations", async () => {
      const bSees = async (op, act, pred) => {
        const reply = await act();
        const ok = reply?.ok === true;
        const row = ok ? (await listB()).find((r) => r.id === deskId) : null;
        rec.mutations.push({ op, from: "desktop", ok, seen: Boolean(row && pred(row)), ...(ok ? {} : { reason: reply?.error?.code }) });
      };
      const edited = `G8-A04 desktop edited ${tag}`;
      await bSees("edit", () => desk.comments.update({ path: desk.path, commentId: deskId, body: edited }), (r) => r.body === edited);
      await bSees("resolve", () => desk.comments.resolve({ path: desk.path, commentId: deskId }), (r) => Boolean(r.resolved_at));
      await bSees("reopen", () => desk.comments.reopen({ path: desk.path, commentId: deskId }), (r) => !r.resolved_at);
      const deskSees = async (op, act, pred) => {
        const res = await act();
        if (!isOk(res.status)) {
          rec.mutations.push({ op, from: "web", ok: false, seen: false, reason: String(res.status) });
          return;
        }
        const seen = await waitDesktopSees({ ctrl: desk.ctrl, path: desk.path, probe: () => listDesk(), pred: (v) => v?.comments?.some((r) => r.id === webId && pred(r)), ...waitOpts });
        rec.mutations.push({ op, from: "web", ok: true, seen: seen.seen, elapsedMs: seen.elapsedMs });
      };
      const webEdited = `G8-A04 web edited ${tag}`;
      await deskSees("edit", () => B.call("updateDocumentComment", { documentID: doc.documentId, commentID: webId }, { body: webEdited }), (r) => r.body === webEdited);
      await deskSees("resolve", () => B.call("resolveDocumentComment", { documentID: doc.documentId, commentID: webId }), (r) => Boolean(r.resolved_at));
    });

    await ctx.step("hard-delete", async () => {
      const before = (await listDesk()).list_token;
      const res = await B.call("deleteDocumentComment", { documentID: doc.documentId, commentID: webId });
      rec.hardDelete = { deleted: isOk(res.status), outcome: res.body?.outcome ?? null };
      const gone = await waitDesktopSees({ ctrl: desk.ctrl, path: desk.path, probe, pred: (v) => Array.isArray(v?.commentIds) && !v.commentIds.includes(webId), ...waitOpts });
      const after = await listDesk(before);
      Object.assign(rec.hardDelete, { tokenChanged: after.unchanged === false && after.list_token !== before, goneOnDesktop: gone.seen, elapsedMs: gone.elapsedMs });
    });

    await ctx.step("concurrent", async () => {
      const [d, w] = await Promise.all([
        desk.comments.create({ path: desk.path, kind: "comment", body: `G8-A04 concurrent desktop ${tag}`, anchor, baseVersionId: versionId }),
        webCreate(`G8-A04 concurrent web ${tag}`),
      ]);
      const ids = [d?.ok ? d.value?.comment?.id : null, w.body?.comment?.id ?? null].filter(Boolean);
      const rows = (await listB()).filter((r) => String(r.body).startsWith("G8-A04 concurrent") && String(r.body).endsWith(tag)).length;
      rec.concurrent = { statuses: [d?.ok ? 201 : 0, w.status], ids, rows };
    });

    await ctx.step("offline", async () => {
      const draft = `G8-A04 draft ${tag}`;
      const typed = await desk.ctrl.evalBounded(desk.page, typeDraft, { text: draft }, "draft:type");
      rec.offline = { draftTyped: typed?.ok === true };
      setOnline(ctx.runDir, false);
      wentOffline = true;
      const off = await waitDesktopSees({ ctrl: desk.ctrl, path: desk.path, probe, pred: (v) => v?.warn === true, ...waitOpts });
      Object.assign(rec.offline, { readOnly: off.seen, sendBlocked: off.value?.sendDisabled === true, draftKept: off.value?.draft === draft });
      setOnline(ctx.runDir, true);
      wentOffline = false;
      const back = await waitDesktopSees({ ctrl: desk.ctrl, path: desk.path, probe, pred: (v) => v?.warn === false, ...waitOpts });
      Object.assign(rec.offline, { recovered: back.seen, draftKeptAfter: back.value?.draft === draft });
      rec.panels.desktop = back.value?.panels ?? rec.panels.desktop;
    });

    rec.g8A03AddOn = await a03AddOn({ A, desk, documentId: doc.documentId, tag, sleep });
    return out(decideG8A04(rec));
  } catch (err) {
    return out({ status: "FAIL", reason: err instanceof Error ? err.message : String(err) });
  } finally {
    if (wentOffline) setOnline(ctx.runDir, true);
    if (desk?.ctrl) await Promise.resolve(desk.ctrl.close?.()).catch(() => {});
  }
}

/**
 * G8-A03 add-on (breakdown §1 A03): A starts the document's Discussion from
 * the shell panel (fork packages/electron-utils/src/discussion-bridge.ts:20-28),
 * renames the document from the app (aiOffice.uniworkRenameDocument, fork
 * apps/shell/src/preload/index.ts:1023), the server still lists that one
 * discussion, and a copy (POST /documents/{id}/copies) carries no comments.
 * Never changes the A04 status; A03's own evidence line is the go test.
 */
async function a03AddOn({ A, desk, documentId, tag, sleep }) {
  const rec = {};
  try {
    const disc = unwrap(await desk.ctrl.discussion().create({ path: desk.path, kind: "discussion", body: `G8-A03 discussion ${tag}` }), "discussion.create").comment;
    rec.discussionId = disc?.id ?? null;
    const title = `G8-A03 renamed ${tag}`;
    const renamed = await desk.ctrl.aiOffice("uniworkRenameDocument", documentId, title);
    if (renamed && renamed.ok === false) throw new Error(`uniworkRenameDocument: ${renamed.error?.code ?? renamed.error ?? "refused"}`);
    const after = await pollUntil(() => A.call("getDocument", { documentID: documentId }), (r) => r.body?.document?.title === title, { boundMs: 15_000, intervalMs: 1_000, sleep });
    const list = await A.call("listDocumentComments", { documentID: documentId }, undefined, { query: { kind: "discussion" } });
    rec.afterRename = { ids: (list.body?.comments ?? []).filter((c) => !c.parent_id && (c.kind ?? "discussion") === "discussion").map((c) => c.id), titleChanged: after.ok };
    const copy = await A.call("copyDocument", { documentID: documentId }, { consent: "copy", title: `G8-A03 copy ${tag}` });
    const copyId = copy.body?.document?.id ?? null;
    if (!copyId) throw new Error(`copyDocument answered ${copy.status}`);
    const copied = await A.call("listDocumentComments", { documentID: copyId });
    rec.copy = { copyId, comments: (copied.body?.comments ?? []).length };
    return { ...decideA03AddOn(rec), record: rec };
  } catch (err) {
    return { status: "FAIL", reason: err instanceof Error ? err.message : String(err), record: rec };
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  const code = await rowMain("comments", (ctx) => {
    if (ctx.row === "G8-A01") return runG8A01(ctx);
    if (ctx.row === "G8-A04") return runG8A04(ctx);
    return { status: "FAIL", reason: `comments.mjs runs G8-A01 and G8-A04, not ${ctx.row}` };
  });
  process.exit(code);
}
