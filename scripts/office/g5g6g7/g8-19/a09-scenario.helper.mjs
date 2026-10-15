// Test kit for the G8-A09 row modules (account.mjs, library.mjs; UNI-1414 T4):
// scripts the g8-19 fake world (fake-world.mjs) so the app, the server and the
// world agree with each other the way the real ones do, with fault knobs that
// make one claim of the row false. Not a test file: the cloud round runs
// g8-19/*.test.mjs only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const A09_ORG_ERROR = "member_deactivated";

/**
 * @param fake  createFakeWorld() result
 * @param opts  { stamp, viewerKey = "M", userDataDir, faults }
 *   faults: choiceNotShown, orgCallsBeforeChoice (number | null), forgetsOrg,
 *   createAddsNothing, createMakesCopy, extraWorkingCopy, renameNotReflected,
 *   webRenameNeverArrives, archiveNotReflected, restoreNotReflected,
 *   propertiesVersionOff, sharedMissing, deactivatedStillWorks,
 *   selectOrgRejects (a message: the app's accountSelectOrg call is rejected with it, as on a malformed membership body),
 *   statusByPathGone (the app renames the working copy on a web rename, so uniworkDocStatus(old path) is null;
 *   the title is then only in binding.json, as the real service writes it)
 */
export function a09Scenario(fake, { stamp = "t1", viewerKey = "M", userDataDir, faults = {} } = {}) {
  const { world, script } = fake;
  const viewer = world.user(viewerKey);
  const orgX = world.org("X");
  const orgY = world.org("Y");
  const w1 = world.workspace("X", "W1");
  const w2 = world.workspace("X", "W2");
  const names = { created: `G8-A09 ${stamp}`, renamed: `G8-A09 ${stamp} renamed`, web: `G8-A09 ${stamp} web` };
  const state = {
    deactivated: false,
    focusCount: 0,
    appTitle: null,
    selectedOrg: null,
    remembered: null,
    listCalls: 0,
    docs: new Map(),
    created: [],
  };
  const sharedId = "doc-1"; // the first world.upload of the fake
  state.docs.set(sharedId, {
    id: sharedId,
    workspace_id: w2.id,
    title: "shared by owner",
    revision: "1",
    current_version: 1,
    my_level: "view",
    created_by: "user-A",
    updated_by: "user-A",
    archived_at: null,
  });
  const newId = "doc-new";
  const summary = (d) => ({ id: d.id, workspaceId: d.workspace_id, title: d.title, format: "docx", archived: Boolean(d.archived_at) });
  const ok = (value) => ({ ok: true, value });
  const refused = () => ({ ok: false, error: A09_ORG_ERROR });
  const orgRow = (o) => ({ id: o.id, slug: o.slug, role: "member", membership: "active" });

  // ---- sign-in and org choice ------------------------------------------------
  const multi = viewerKey === "M" && world.user("M").multiOrg?.status === "SEEDED";
  const orgs = multi ? [orgRow(orgX), orgRow(orgY)] : [orgRow(orgX)];
  script.respond("app.signIn", () => {
    const needsChoice = multi && !faults.choiceNotShown && (state.remembered === null || faults.forgetsOrg);
    if (!needsChoice) {
      const org = multi ? (state.remembered ?? orgY.id) : orgX.id;
      state.selectedOrg = org;
      return {
        status: { loggedIn: true, state: "signed-in", needsOrgChoice: false, org: { id: org }, orgs },
        orgChoiceShown: false,
        expectOrgChoice: false,
        sessionBinExists: true,
        orgApiCallsBeforeChoice: null,
      };
    }
    state.selectedOrg = null;
    return {
      status: { loggedIn: true, state: "signed-in", needsOrgChoice: true, orgs },
      orgChoiceShown: true,
      expectOrgChoice: true,
      sessionBinExists: true,
      orgApiCallsBeforeChoice: faults.orgCallsBeforeChoice === undefined ? 0 : faults.orgCallsBeforeChoice,
    };
  });
  script.respond("app.selectOrg", (call) => {
    const orgId = call.args[0];
    if (faults.selectOrgRejects) throw new Error(faults.selectOrgRejects);
    state.selectedOrg = orgId;
    state.remembered = orgId;
    return { loggedIn: true, state: "signed-in", needsOrgChoice: false, org: { id: orgId }, orgs };
  });

  // the app's binding.json of the opened document carries its title (BindingStore.write on a rename)
  function writeBindings() {
    for (const dir of state.bindingDirs ?? []) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "binding.json"), JSON.stringify({ documentId: newId, state: "clean", title: state.appTitle }));
    }
  }

  // ---- library ---------------------------------------------------------------
  const aiOffice = (name, answer) => script.respond(`app.aiOffice.${name}`, answer);
  aiOffice("uniworkListWorkspaces", () =>
    state.deactivated && !faults.deactivatedStillWorks ? refused() : ok([{ id: w1.id, name: "W1", orgId: orgX.id, slug: w1.slug, orgSlug: orgX.slug, myRole: viewerKey === "A" ? "owner" : "member" }]),
  );
  aiOffice("uniworkListSharedWithMe", () =>
    ok({ documents: faults.sharedMissing ? [] : [summary(state.docs.get(sharedId))], nextCursor: null }),
  );
  aiOffice("uniworkDocumentProperties", (call) => {
    const d = state.docs.get(call.args[0]);
    return ok({
      documentId: d.id,
      workspaceId: d.workspace_id,
      title: d.title,
      ownerName: null,
      createdByName: null,
      createdAt: null,
      updatedByName: null,
      updatedAt: null,
      myLevel: d.my_level,
      version: d.current_version + (faults.propertiesVersionOff ? 1 : 0),
      versionByName: null,
      ownerId: null,
      createdById: d.created_by,
      updatedById: d.updated_by,
    });
  });
  aiOffice("uniworkListDocuments", () => {
    state.listCalls += 1;
    return ok({ documents: state.created.map((id) => summary(state.docs.get(id))), nextCursor: null });
  });
  aiOffice("uniworkCreateDocument", (call) => {
    if (state.deactivated && !faults.deactivatedStillWorks) return refused();
    const input = call.args[0];
    const make = (id, title) => {
      state.docs.set(id, {
        id,
        workspace_id: input.workspaceId,
        title,
        revision: "1",
        current_version: 1,
        my_level: "manage",
        created_by: viewer.id,
        updated_by: viewer.id,
        archived_at: null,
      });
      return id;
    };
    if (!faults.createAddsNothing) state.created.push(make(newId, input.name));
    if (faults.createMakesCopy) state.created.push(make("doc-copy", input.name));
    return ok(summary(state.docs.get(newId) ?? { id: newId, workspace_id: input.workspaceId, title: input.name }));
  });
  aiOffice("uniworkOpenDocument", (call) => {
    const id = call.args[0];
    if (userDataDir) {
      const dirs = faults.extraWorkingCopy ? [id, `${id}-second`] : [id];
      for (const key of dirs) {
        const dir = join(userDataDir, "uniwork-documents", "harness", viewer.id, key);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "binding.json"), JSON.stringify({ documentId: id, state: "clean", title: state.docs.get(id)?.title ?? null }));
      }
    }
    state.appTitle = state.docs.get(id)?.title ?? null;
    state.bindingDirs = userDataDir ? [join(userDataDir, "uniwork-documents", "harness", viewer.id, id)] : [];
    writeBindings();
    return ok({ path: `/fake/${id}.docx` });
  });
  aiOffice("uniworkRenameDocument", (call) => {
    const [id, name] = call.args;
    const d = state.docs.get(id);
    d.title = faults.renameNotReflected ? d.title : name;
    state.appTitle = name;
    return ok(summary({ ...d, title: name }));
  });
  aiOffice("uniworkArchiveDocument", (call) => {
    const d = state.docs.get(call.args[0]);
    if (!faults.archiveNotReflected) d.archived_at = "2026-10-15T00:00:00Z";
    return ok(summary({ ...d, archived_at: "2026-10-15T00:00:00Z" }));
  });
  aiOffice("uniworkRestoreDocument", (call) => {
    const d = state.docs.get(call.args[0]);
    if (!faults.restoreNotReflected) d.archived_at = null;
    return ok(summary({ ...d, archived_at: null }));
  });
  aiOffice("uniworkDocStatus", (call) => (state.webRenamed && faults.statusByPathGone ? null : { path: call.args[0], documentId: newId, title: state.appTitle, state: "ready" }));
  script.respond("app.focus", () => {
    state.focusCount += 1;
    // the desktop picks a web rename up on a focus (onUniworkDocRenamed)
    if (!faults.webRenameNeverArrives && state.focusCount >= 2) {
      state.appTitle = state.docs.get(newId)?.title ?? state.appTitle;
      state.webRenamed = true;
      writeBindings();
    }
    return { activated: true, pages: 1 };
  });

  // ---- server (api) ------------------------------------------------------------
  script.respond("api.getDocument", (call) => {
    const d = state.docs.get(call.args.pathParams.documentID);
    return d ? { status: 200, body: { document: { ...d, archived_at: d.archived_at ?? undefined } } } : { status: 404, body: { error: "not_found" } };
  });
  script.respond("api.patchDocument", (call) => {
    const d = state.docs.get(call.args.pathParams.documentID);
    if (!d || call.args.body.revision !== d.revision) return { status: 409, body: { error: "conflict" } };
    d.title = call.args.body.title;
    d.revision = String(Number(d.revision) + 1);
    return { status: 200, body: { document: { ...d } } };
  });

  // ---- world -------------------------------------------------------------------
  script.respond("world.deactivate", () => {
    state.deactivated = true;
    return { status: 200 };
  });

  return { state, names, newId, sharedId, viewer, orgX, orgY, w1, w2, multi };
}
