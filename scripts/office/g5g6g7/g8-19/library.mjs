// G8-A09, library half (UNI-1414 T4): what the desktop library shows after a
// sign-in and what create / rename / archive from the app do to the one UniWork
// document. `decideG8A09Docs(record)` is the pure decision the tests drive;
// `gatherLibrary(ctx, deps)` is the flow that fills the record through the app's
// own `window.aiOffice.uniwork*` calls and the server API; `runLibrary` is the
// standalone row module (account.mjs runs the same gather inside the full row).
//
// Claims (plan card G8-19, AC G8-A09): the library lists the workspaces with the
// role, the shared-with-me section lists a document shared from another
// workspace, the properties equal the server, a create adds exactly one
// document and opens it by id with no second local working copy, a rename and an
// archive are visible on GET /documents/{id}, and a rename made on the web
// reaches the desktop title after a focus.
//
// Out of scope here: the S16-S18 screenshots (tester_visual) and the web
// library UI. The "web rename" is the PATCH /documents/{id} the web library
// itself sends, with the revision read first (api-contract `patchDocument`).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { sleep } from "../harness/app-steps.mjs";
import { isMainModule } from "../harness/lib.mjs";
import { rowMain } from "./run-row.mjs";

export const MAX_LIST_PAGES = 20;
/** the desktop learns a web rename on a focus or its 30 s poll; one more poll's worth of margin */
export const DEFAULT_WEB_RENAME_WAIT_MS = 35_000;
export const DEFAULT_WEB_RENAME_POLL_MS = 2_000;

const levelOf = (value) => value ?? "view"; // D omits my_level on a view row

function check(ok, detail) {
  return { ok: Boolean(ok), detail: String(detail) };
}

/**
 * The verdict for the library half. `record` (every part optional; a missing
 * part fails its checks):
 *   workspaces { ok, error?, ids, expectedWorkspaceId, myRole, expectedRoles }
 *   shared     { ok, error?, ids, expectedDocumentId }
 *   properties { app, server }   app = UniworkDocProperties, server = GET /documents/{id}.document
 *   create     { ok, error?, before, after, createdId, expectedTitle, titleCount, serverStatus, serverTitle, openOk, workingCopies }
 *   rename     { ok, error?, expectedTitle, serverStatus, serverTitle }
 *   webRename  { patchStatus, expectedTitle, appTitleAfterFocus, focuses }
 *   archive    { archiveOk, serverArchived, restoreOk, serverRestored }
 * Returns { status: "PASS" | "FAIL", reason, checks }.
 */
export function decideG8A09Docs(record) {
  const r = record ?? {};
  const ws = r.workspaces ?? {};
  const shared = r.shared ?? {};
  const props = r.properties ?? {};
  const create = r.create ?? {};
  const rename = r.rename ?? {};
  const web = r.webRename ?? {};
  const archive = r.archive ?? {};
  const checks = {};

  checks.workspacesWithRole = ws.ok
    ? check(
        Array.isArray(ws.ids) && ws.ids.includes(ws.expectedWorkspaceId) && Array.isArray(ws.expectedRoles) && ws.myRole != null && ws.expectedRoles.includes(ws.myRole),
        `workspace ${ws.expectedWorkspaceId} listed=${Array.isArray(ws.ids) && ws.ids.includes(ws.expectedWorkspaceId)} role=${ws.myRole ?? "none"} expected ${JSON.stringify(ws.expectedRoles ?? null)}`,
      )
    : check(false, `the app's workspace list answered ${ws.error ?? "nothing"}`);

  checks.sharedListed = shared.ok
    ? check(Array.isArray(shared.ids) && shared.ids.includes(shared.expectedDocumentId), `shared-with-me lists ${shared.ids?.length ?? 0} document(s); ${shared.expectedDocumentId} present=${Array.isArray(shared.ids) && shared.ids.includes(shared.expectedDocumentId)}`)
    : check(false, `the shared-with-me list answered ${shared.error ?? "nothing"}`);

  const { app, server } = props;
  if (app && server) {
    const diffs = [];
    if (app.documentId !== server.id) diffs.push(`id ${app.documentId} != ${server.id}`);
    if (app.workspaceId !== server.workspace_id) diffs.push(`workspace ${app.workspaceId} != ${server.workspace_id}`);
    if (app.title !== server.title) diffs.push("title differs");
    if (levelOf(app.myLevel) !== levelOf(server.my_level)) diffs.push(`level ${levelOf(app.myLevel)} != ${levelOf(server.my_level)}`);
    if (app.version !== server.current_version) diffs.push(`version ${app.version} != ${server.current_version}`);
    if (app.createdById != null && app.createdById !== server.created_by) diffs.push("created_by differs");
    if (app.updatedById != null && app.updatedById !== server.updated_by) diffs.push("updated_by differs");
    checks.propertiesEqualServer = check(diffs.length === 0, diffs.length === 0 ? "properties equal GET /documents/{id}" : diffs.join(", "));
  } else {
    checks.propertiesEqualServer = check(false, `properties missing (app=${Boolean(app)}, server=${Boolean(server)}${props.appError ? `, app error ${props.appError}` : ""})`);
  }

  if (create.ok) {
    checks.createdPlusOne = check(Number.isInteger(create.before) && create.after === create.before + 1, `documents before=${create.before} after=${create.after}`);
    checks.createdOnce = check(
      create.titleCount === 1 && create.serverStatus === 200 && create.serverTitle === create.expectedTitle,
      `titleCount=${create.titleCount} GET ${create.serverStatus} title ${create.serverTitle === create.expectedTitle ? "equal" : "differs"}`,
    );
    checks.openedById = check(create.openOk === true, `open by id ${create.createdId} ${create.openOk ? "ok" : `failed${create.openError ? ` (${create.openError})` : ""}`}`);
    checks.workingCopyUnique = check(create.workingCopies === 1, `working copies of the document: ${create.workingCopies}`);
  } else {
    const why = `create answered ${create.error ?? "nothing"}`;
    for (const name of ["createdPlusOne", "createdOnce", "openedById", "workingCopyUnique"]) checks[name] = check(false, why);
  }

  checks.renameReflected =
    rename.ok === true
      ? check(rename.serverStatus === 200 && rename.serverTitle === rename.expectedTitle, `GET ${rename.serverStatus} title ${rename.serverTitle === rename.expectedTitle ? "equal" : "differs"} after the app renamed`)
      : check(false, `rename answered ${rename.error ?? "nothing"}`);

  checks.webRenameOnDesktop = check(
    web.patchStatus === 200 && web.appTitleAfterFocus === web.expectedTitle,
    web.patchStatus === 200 ? `desktop title ${web.appTitleAfterFocus === web.expectedTitle ? "equal" : "still old"} after ${web.focuses ?? 0} focus(es)` : `web rename PATCH answered ${web.patchStatus ?? "nothing"}`,
  );

  checks.archiveReflected = check(archive.archiveOk === true && archive.serverArchived === true, `app archive ok=${archive.archiveOk}, GET shows archived_at=${archive.serverArchived}`);
  checks.restoreReflected = check(archive.restoreOk === true && archive.serverRestored === true, `app restore ok=${archive.restoreOk}, GET shows archived_at gone=${archive.serverRestored}`);

  const failed = Object.entries(checks).filter(([, c]) => !c.ok);
  return failed.length === 0
    ? { status: "PASS", reason: "", checks }
    : { status: "FAIL", reason: failed.map(([name, c]) => `${name}: ${c.detail}`).join("; "), checks };
}

/**
 * How many local working copies of `documentId` exist under
 * `<userData>/uniwork-documents/<deployment>/<account>/<key>/`: a directory
 * named by the id, or one whose binding.json is bound to it. A second one means
 * the app copied the document instead of opening it by id.
 */
export function countWorkingCopies(userDataDir, documentId) {
  const root = join(userDataDir ?? "", "uniwork-documents");
  if (!userDataDir || !documentId || !existsSync(root)) return 0;
  const dirs = (path) => {
    try {
      return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(path, d.name));
    } catch {
      return [];
    }
  };
  let count = 0;
  for (const deployment of dirs(root)) {
    for (const account of dirs(deployment)) {
      for (const dir of dirs(account)) {
        let bound = false;
        try {
          bound = JSON.parse(readFileSync(join(dir, "binding.json"), "utf8")).documentId === documentId;
        } catch {
          // no readable binding: the directory name decides
        }
        if (bound || basename(dir) === documentId) count += 1;
      }
    }
  }
  return count;
}

const appError = (res) => (res && typeof res === "object" && res.ok === false ? String(res.error ?? "unknown") : "no answer");

/**
 * Fills the library record through ctx.step (one step per claim); returns it.
 * deps: { ctrl, world, viewerKey, stamp, userDataDir?, pollMs?, waitMs?, sleep? }.
 * viewerKey is the account signed in to the app, already on the organization
 * the library should show (M on X after account.mjs's org steps, or A).
 */
export async function gatherLibrary(ctx, deps) {
  const { ctrl, world, viewerKey, stamp } = deps;
  const pollMs = deps.pollMs ?? DEFAULT_WEB_RENAME_POLL_MS;
  const waitMs = deps.waitMs ?? DEFAULT_WEB_RENAME_WAIT_MS;
  const nap = deps.sleep ?? sleep;
  const userDataDir = deps.userDataDir ?? ctx.portsEnv?.UNIWORK_USER_DATA ?? "";
  const app = (name, ...args) => ctrl.aiOffice(name, ...args);
  const viewer = world.user(viewerKey);
  const session = world.session(viewerKey);
  const w1 = world.workspace("X", "W1");
  const sharerKey = viewerKey === "M" ? "A" : "B";
  const names = { created: `G8-A09 ${stamp}`, renamed: `G8-A09 ${stamp} renamed`, web: `G8-A09 ${stamp} web`, shared: `G8-A09 ${stamp} shared` };
  const record = {};

  const getDocument = async (documentId) => {
    const res = await session.call("getDocument", { documentID: documentId });
    if (res.status === 0) throw new Error(`GET /documents/${documentId} did not answer (${res.error})`);
    return res;
  };
  const listAll = async () => {
    const documents = [];
    let cursor;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const res = await app("uniworkListDocuments", { workspaceId: w1.id, limit: 100, ...(cursor ? { cursor } : {}) });
      if (!res?.ok) throw new Error(`uniworkListDocuments answered ${appError(res)}`);
      documents.push(...(res.value?.documents ?? []));
      cursor = res.value?.nextCursor;
      if (!cursor) return documents;
    }
    throw new Error(`the document list has more than ${MAX_LIST_PAGES} pages`);
  };

  await ctx.step("workspaces", async () => {
    const res = await app("uniworkListWorkspaces");
    record.workspaces = res?.ok
      ? {
          ok: true,
          ids: res.value.map((w) => w.id),
          expectedWorkspaceId: w1.id,
          myRole: res.value.find((w) => w.id === w1.id)?.myRole ?? null,
          expectedRoles: viewerKey === "A" ? ["owner", "admin"] : ["member"],
        }
      : { ok: false, error: appError(res) };
    return { details: { ...record.workspaces } };
  });

  await ctx.step("sharedWithMe", async () => {
    const up = await world.upload(sharerKey, "W2", ctx.fixture, { title: names.shared });
    await world.share(sharerKey, up.documentId, viewer.id, "view");
    record.sharedDocumentId = up.documentId;
    const res = await app("uniworkListSharedWithMe", { limit: 100 });
    record.shared = res?.ok
      ? { ok: true, ids: (res.value?.documents ?? []).map((d) => d.id), expectedDocumentId: up.documentId }
      : { ok: false, error: appError(res), expectedDocumentId: up.documentId };
    return { details: { sharedBy: sharerKey, ...record.shared } };
  });

  await ctx.step("properties", async () => {
    if (!record.sharedDocumentId) throw new Error("no shared document to read the properties of (sharedWithMe step failed)");
    const [res, got] = await Promise.all([app("uniworkDocumentProperties", record.sharedDocumentId), getDocument(record.sharedDocumentId)]);
    if (got.status !== 200) throw new Error(`GET /documents/${record.sharedDocumentId} answered ${got.status}`);
    record.properties = { app: res?.ok ? res.value : null, appError: res?.ok ? undefined : appError(res), server: got.body?.document ?? null };
    return { details: { appOk: Boolean(res?.ok), version: res?.ok ? res.value.version : null, myLevel: res?.ok ? res.value.myLevel : null } };
  });

  let created = null;
  await ctx.step("create", async () => {
    const before = (await listAll()).length;
    const res = await app("uniworkCreateDocument", { workspaceId: w1.id, folderId: null, name: names.created, format: "docx" });
    if (!res?.ok) {
      record.create = { ok: false, error: appError(res) };
      return { details: { error: record.create.error } };
    }
    created = res.value;
    const after = await listAll();
    const got = await getDocument(created.id);
    const opened = await app("uniworkOpenDocument", created.id);
    record.create = {
      ok: true,
      before,
      after: after.length,
      createdId: created.id,
      expectedTitle: names.created,
      titleCount: after.filter((d) => d.title === names.created).length,
      serverStatus: got.status,
      serverTitle: got.body?.document?.title ?? null,
      openOk: Boolean(opened?.ok),
      openError: opened?.ok ? undefined : appError(opened),
      workingCopies: countWorkingCopies(userDataDir, created.id),
    };
    created.path = opened?.ok ? opened.value?.path : null;
    return { details: { documentId: created.id, before, after: after.length, workingCopies: record.create.workingCopies } };
  });

  await ctx.step("rename", async () => {
    if (!created) throw new Error("no created document to rename (create step failed)");
    const res = await app("uniworkRenameDocument", created.id, names.renamed);
    const got = await getDocument(created.id);
    record.rename = {
      ok: Boolean(res?.ok),
      error: res?.ok ? undefined : appError(res),
      expectedTitle: names.renamed,
      serverStatus: got.status,
      serverTitle: got.body?.document?.title ?? null,
    };
    return { details: { ok: record.rename.ok, serverStatus: got.status } };
  });

  await ctx.step("webRename", async () => {
    if (!created) throw new Error("no created document to rename (create step failed)");
    const current = await getDocument(created.id);
    const revision = current.body?.document?.revision;
    if (current.status !== 200 || typeof revision !== "string") throw new Error(`GET /documents/${created.id} answered ${current.status} with no revision`);
    const patch = await session.call("patchDocument", { documentID: created.id }, { revision, title: names.web });
    if (patch.status === 0) throw new Error(`PATCH /documents/${created.id} did not answer (${patch.error})`);
    let title = null;
    let focuses = 0;
    if (patch.status === 200) {
      const maxFocuses = Math.max(1, Math.ceil(waitMs / Math.max(1, pollMs)));
      for (let i = 0; i < maxFocuses; i += 1) {
        if (created.path) await ctrl.focus(created.path);
        focuses += 1;
        const status = created.path ? await app("uniworkDocStatus", created.path) : null;
        title = status?.title ?? null;
        if (title === names.web) break;
        await nap(pollMs);
      }
    }
    record.webRename = { patchStatus: patch.status, expectedTitle: names.web, appTitleAfterFocus: title, focuses, via: "PATCH /documents/{id} (the web library's rename call)" };
    return { details: { ...record.webRename } };
  });

  await ctx.step("archive", async () => {
    if (!created) throw new Error("no created document to archive (create step failed)");
    const archived = await app("uniworkArchiveDocument", created.id);
    const afterArchive = await getDocument(created.id);
    const restored = await app("uniworkRestoreDocument", created.id);
    const afterRestore = await getDocument(created.id);
    record.archive = {
      archiveOk: Boolean(archived?.ok),
      serverArchived: Boolean(afterArchive.body?.document?.archived_at),
      restoreOk: Boolean(restored?.ok),
      serverRestored: afterRestore.status === 200 && !afterRestore.body?.document?.archived_at,
    };
    return { details: { ...record.archive } };
  });

  return record;
}

/** a decision as a step result (so the artifact shows the verdict of each half) */
export function decisionStep(ctx, name, decision) {
  return ctx.step(name, async () => ({
    status: decision.status,
    reason: decision.reason ?? "",
    ...(decision.blocker ? { blocker: decision.blocker } : {}),
    ...(decision.owner ? { owner: decision.owner } : {}),
    details: { checks: decision.checks ?? {} },
  }));
}

/** the library half on its own: gather, decide, the row record */
export async function runLibrary(ctx, deps) {
  const record = await gatherLibrary(ctx, deps);
  const decision = decideG8A09Docs(record);
  await decisionStep(ctx, "decide:docs", decision);
  return { status: decision.status, reason: decision.reason, details: { docs: record } };
}

/** standalone CLI: connects the app and runs the library half as the account already signed in (M if it has the second org, else A) */
async function main(ctx) {
  const { connectApp } = await import("../harness/app.mjs");
  const world = await ctx.getWorld();
  let ctrl;
  try {
    ctrl = await connectApp({ portsEnv: ctx.portsEnv, runDir: ctx.runDir, apiOrigin: ctx.apiOrigin });
  } catch (err) {
    const status = err?.appUnavailable?.status === "BLOCKED" ? "BLOCKED" : "FAIL";
    return { status, reason: err?.appUnavailable?.reason ?? err.message, blocker: status === "BLOCKED" ? err.appUnavailable.reason : "", owner: "g7-qa" };
  }
  try {
    const viewerKey = world.user("M")?.multiOrg?.status === "SEEDED" ? "M" : "A";
    await ctx.step("signIn", async () => {
      const signed = await ctrl.signIn(world.user(viewerKey));
      if (viewerKey === "M" && signed.orgChoiceShown) await ctrl.selectOrg(world.org("X").id);
      return { details: { viewerKey } };
    });
    return await runLibrary(ctx, { ctrl, world, viewerKey, stamp: Date.now().toString(36) });
  } finally {
    await ctrl.close();
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) process.exit(await rowMain("library", main));
