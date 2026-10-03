import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { NativeLoginManager } from "../auth/manager";
import type { DesktopDraftStore } from "../drafts/store";
import { createDesktopDraftStore } from "../drafts/store";
import { createFakeDraftKeyStore } from "../drafts/test-fake";
import { FileHandleRegistry } from "../files/registry";
import { createAuthIpcHandlers, createDraftIpcHandlers, createFileIpcHandlers, createIpcDispatcher, createLocalIpcHandlers, createOfficeIpcHandlers, IpcValidationError, validateIpcRequest, type IpcSenderContext } from "../ipc";
import { createOpenedDocuments } from "../opened-documents";
import { createLocalModeStore } from "./mode";
import { createRecentFilesStore } from "./recent-files";
import { deviceScopeAccountId } from "./device";
import { DraftRecoveryError } from "../../../../packages/core/office/draft-recovery";

const roots: string[] = [];
async function root(): Promise<string> { const path = resolve(".test-artifacts", `no-network-${Date.now()}-${Math.random().toString(16).slice(2)}`); await fs.mkdir(path, { recursive: true }); roots.push(path); return path; }
afterEach(async () => { while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true }); });

const sessionGeneration = "session_1234";
const sender: IpcSenderContext = { senderId: 7, frameId: 0, origin: "uniwork-office-app://app", expectedSenderId: 7, expectedFrameId: 0, expectedOrigin: "uniwork-office-app://app", sessionGeneration };
const DEVICE_ID = "f".repeat(32);
const deviceScope = { sessionId: sessionGeneration, deploymentId: "local-device", accountId: deviceScopeAccountId(DEVICE_ID), generation: 1 };

describe("local mode opens no network connection", () => {
  it("never lets the renderer choose a draft namespace, identity or path", () => {
    const checkpoint = { sessionGeneration, documentId: "doc-1", draftId: "d:1", generation: 1, dataBase64: "b2s=" };
    expect(() => validateIpcRequest("desktop:draft-checkpoint", checkpoint, sender)).not.toThrow();
    for (const extra of [{ namespace: "local:zzz" }, { accountId: "account-b" }, { deploymentId: "other" }, { workspaceId: "ws-2" }, { path: "C:\\secret.docx" }]) {
      expect(() => validateIpcRequest("desktop:draft-checkpoint", { ...checkpoint, ...extra }, sender)).toThrow(IpcValidationError);
    }
    expect(() => validateIpcRequest("desktop:draft-list", { sessionGeneration, documentId: "doc-1", namespace: "local:zzz" }, sender)).toThrow(IpcValidationError);
    expect(() => validateIpcRequest("desktop:recent-open", { sessionGeneration, id: `recent_${"a".repeat(32)}`, path: "C:\\secret.docx" }, sender)).toThrow(IpcValidationError);
    expect(() => validateIpcRequest("desktop:local-mode", { sessionGeneration, local: true, namespace: "local:zzz" }, sender)).toThrow(IpcValidationError);
  });

  it("refuses every cloud channel signed out without touching the transport", async () => {
    let calls = 0;
    const transport = new Proxy({}, { get: () => (..._args: unknown[]) => { calls += 1; return Promise.reject(new Error("network attempted")); } });
    const handlers = createOfficeIpcHandlers({ transport: transport as never, isSignedIn: () => false });
    const dispatch = createIpcDispatcher(handlers, sender);
    for (const channel of ["desktop:library-list", "desktop:library-context", "desktop:library-recent", "desktop:library-search", "desktop:library-create", "desktop:library-download", "desktop:office-open", "desktop:office-save"]) {
      const payload = channel === "desktop:office-save"
        ? { sessionGeneration, workspaceId: "ws", documentId: "doc", intentId: "i", idempotencyKey: "k", baseVersionId: "v", baseRevision: "1", dataBase64: "b2s=", checksum: `sha256:${"a".repeat(64)}` }
        : channel === "desktop:library-create" ? { sessionGeneration, workspaceId: "ws", title: "Plan.docx" }
        : channel === "desktop:library-search" ? { sessionGeneration, workspaceId: "ws", query: "plan" }
        : channel === "desktop:library-context" ? { sessionGeneration }
        : { sessionGeneration, workspaceId: "ws", ...(channel === "desktop:office-open" || channel === "desktop:library-download" ? { documentId: "doc" } : {}) };
      await expect(dispatch(channel, payload)).rejects.toMatchObject({ code: "login_required" });
    }
    expect(calls).toBe(0);
  });

  it("answers auth metadata reads from main state without a network call", async () => {
    let calls = 0;
    const manager = {
      isBound: () => true,
      getBinding: () => ({ clientId: "com.uniwork.office", deploymentId: "production-eu" }),
      getMetadata: () => ({ status: "signed-out" as const }),
      cancelLogin: () => ({ status: "signed-out" as const }),
      startLogin: async () => { calls += 1; throw new Error("network attempted"); },
      logout: async () => { calls += 1; throw new Error("network attempted"); },
    } as unknown as NativeLoginManager;
    const handlers = createAuthIpcHandlers(manager);
    const dispatch = createIpcDispatcher(handlers, sender);
    await expect(dispatch("desktop:auth-session", { sessionGeneration })).resolves.toEqual({ status: "signed-out" });
    await expect(dispatch("desktop:auth-config", { sessionGeneration })).resolves.toEqual({ clientId: "com.uniwork.office", deploymentId: "production-eu" });
    expect(calls).toBe(0);
  });

  it("returns typed unsupported, missing and locked answers instead of guessing at error codes", async () => {
    const rootDirectory = await root();
    const txtPath = join(rootDirectory, "notes.txt");
    const gonePath = join(rootDirectory, "gone.docx");
    await fs.writeFile(txtPath, "text");
    const keys = createFakeDraftKeyStore();
    const registry = new FileHandleRegistry({ sessionId: sessionGeneration });
    const recents = createRecentFilesStore({ userDataDirectory: rootDirectory, keyStore: keys, deviceId: DEVICE_ID });
    await recents.record({ path: gonePath, name: "gone.docx", modifiedAtMs: 1 });
    const fileDispatcher = createIpcDispatcher(createFileIpcHandlers({
      registry, session: () => deviceScope, recents,
      pickOpen: async () => txtPath,
      onOpened: () => undefined,
    }), sender);

    expect(await fileDispatcher("desktop:file-pick-open", { sessionGeneration })).toEqual({ opened: false, unsupported: true });
    const recentId = (await recents.list())[0]!.id;
    expect(await fileDispatcher("desktop:recent-open", { sessionGeneration, id: recentId })).toEqual({ opened: false, missing: true });

    const lockedStore = { list: async () => { throw new DraftRecoveryError("draft_recovery_locked", "locked"); } };
    const draftDispatcher = createIpcDispatcher(createDraftIpcHandlers({ store: lockedStore as never, session: deviceScope, accountSession: () => deviceScope }), sender);
    expect(await draftDispatcher("desktop:draft-list", { sessionGeneration })).toEqual({ drafts: [], locked: true });
  });

  it("serves every local-mode channel with the throwing transport present", async () => {
    let calls = 0;
    const transport = new Proxy({}, { get: () => (..._args: unknown[]) => { calls += 1; return Promise.reject(new Error("network attempted")); } });
    const rootDirectory = await root();
    const source = join(rootDirectory, "source.docx");
    await fs.writeFile(source, "old");
    const destination = join(rootDirectory, "copy.docx");
    const keys = createFakeDraftKeyStore();
    const registry = new FileHandleRegistry({ sessionId: sessionGeneration });
    const metadata = await registry.openPath(source);
    const documents = createOpenedDocuments({ sessionFor: (kind) => kind === "local" ? deviceScope : undefined });
    const localIdentity = (handle: string, file: { modifiedAtMs: number; checksum: string }) => ({ deploymentId: "local-device", accountId: deviceScope.accountId, organizationId: "local", workspaceId: "local", documentId: registry.identityFor(handle), base: { revision: String(Math.trunc(file.modifiedAtMs)), version: file.checksum } });
    documents.open(metadata.handle, "local", localIdentity(metadata.handle, metadata));
    const store: DesktopDraftStore = createDesktopDraftStore({ rootDirectory: join(rootDirectory, "drafts"), keyStore: keys });
    const mode = await createLocalModeStore({ userDataDirectory: rootDirectory });
    const recents = createRecentFilesStore({ userDataDirectory: rootDirectory, keyStore: keys, deviceId: DEVICE_ID });
    const dispatcher = createIpcDispatcher({
      ...createLocalIpcHandlers({ mode, recents }),
      ...createFileIpcHandlers({
        registry, saveGuard: undefined, session: () => deviceScope, recents,
        pickOpen: async () => source,
        pickSaveAs: async () => destination,
        isOpened: (handle) => documents.context(handle)?.kind === "local",
        beginSave: documents.beginSave,
        onOpened: (next) => { documents.open(next.handle, "local", localIdentity(next.handle, next)); },
        onSaveConfirmed: () => undefined,
        onSaveAsConfirmed: (previousHandle, next) => { if (!documents.rebindLocal(previousHandle, next.handle, localIdentity(next.handle, next))) throw new Error("document_context_refused"); },
      }),
      "desktop:draft-list": async () => ({ drafts: await store.list({ session: deviceScope }) }),
    }, sender);

    expect(await dispatcher("desktop:local-state", { sessionGeneration })).toEqual({ localMode: false });
    expect(await dispatcher("desktop:local-mode", { sessionGeneration, local: true })).toEqual({ localMode: true });
    expect(await dispatcher("desktop:file-pick-open", { sessionGeneration })).toMatchObject({ opened: true, metadata: { name: "source.docx" } });
    await recents.record({ path: source, name: "source.docx", modifiedAtMs: 5 });
    expect(await dispatcher("desktop:recent-list", { sessionGeneration })).toMatchObject({ files: [expect.objectContaining({ name: "source.docx" })] });
    const recentId = (await dispatcher("desktop:recent-list", { sessionGeneration }) as { files: Array<{ id: string }> }).files[0]!.id;
    expect(await dispatcher("desktop:recent-open", { sessionGeneration, id: recentId })).toMatchObject({ opened: true, metadata: { name: "source.docx" } });
    expect(await dispatcher("desktop:file-create", { sessionGeneration })).toMatchObject({ opened: true, metadata: { untitled: true } });
    const untitled = (await dispatcher("desktop:file-create", { sessionGeneration }) as { metadata: { handle: string } }).metadata.handle;
    expect(await dispatcher("desktop:file-save", { sessionGeneration, handle: metadata.handle, dataBase64: "bmV3" })).toMatchObject({ opened: true });
    expect(await fs.readFile(source, "utf8")).toBe("new");
    expect(await dispatcher("desktop:file-save-as", { sessionGeneration, handle: metadata.handle, dataBase64: "Y29waWVk" })).toMatchObject({ opened: true, metadata: { name: "copy.docx" } });
    expect(await fs.readFile(destination, "utf8")).toBe("copied");
    expect(untitled).toMatch(/^file_/);
    expect(await dispatcher("desktop:draft-list", { sessionGeneration })).toEqual({ drafts: [] });
    expect(await dispatcher("desktop:recent-remove", { sessionGeneration, id: recentId })).toEqual({ removed: true });
    await expect(dispatcher("desktop:file-save", { sessionGeneration, handle: metadata.handle, dataBase64: "b2s=", path: "C:\\secret" })).rejects.toMatchObject({ code: "schema" });
    expect(calls).toBe(0);
  }, 20_000);
});
