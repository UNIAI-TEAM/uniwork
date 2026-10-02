import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createOfficeSaveGuard } from "../../../packages/core/office/save-guard";
import { FileHandleRegistry, type FileSystemPort } from "./files/registry";
import { localDraftIdentity } from "./files/protected-files";
import { createFileIpcHandlers } from "./ipc";
import { createOpenedDocuments } from "./opened-documents";

const sessionGeneration = "session_1234";
const session = { sessionId: sessionGeneration, deploymentId: "dep", accountId: "account", generation: 1 };
const nativeFs: FileSystemPort = { lstat: (path) => fs.lstat(path), stat: (path) => fs.stat(path), realpath: (path) => fs.realpath(path), readFile: async (path) => new Uint8Array(await fs.readFile(path)), open: (path, flags) => fs.open(path, flags), rename: (from, to) => fs.rename(from, to), unlink: (path) => fs.unlink(path) };
async function fixture(port = nativeFs) {
  const parent = resolve("../../.uniwork-dev-run/local-tab-lifecycle");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "case-"));
  const path = join(root, "source.docx");
  await fs.writeFile(path, "old");
  const registry = new FileHandleRegistry({ sessionId: sessionGeneration, fs: port });
  const metadata = await registry.openPath(path);
  const documents = createOpenedDocuments({ session: () => session, onClosed: (id) => registry.revoke(id) });
  documents.open(metadata.handle, "local", localDraftIdentity(session, registry.identityFor(metadata.handle), metadata));
  documents.update({ documentIds: [metadata.handle], activeDocumentId: metadata.handle });
  return { root, path, registry, metadata, documents };
}

it("retains a local context through atomic replacement and consumes its protected checkpoint before closing", async () => {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const replaced = new Promise<void>((resolve) => { entered = resolve; });
  const h = await fixture({ ...nativeFs, rename: async (from, to) => { await fs.rename(from, to); entered(); await gate; } });
  let protectedRow = false;
  const checkpoint = vi.fn(async () => { protectedRow = true; });
  const confirmed = vi.fn(() => { protectedRow = false; });
  const handlers = createFileIpcHandlers({ registry: h.registry, session: () => session, saveGuard: createOfficeSaveGuard(), isOpened: (id) => h.documents.context(id)?.kind === "local", beginSave: h.documents.beginSave, checkpoint, onSaveConfirmed: confirmed });
  const saving = handlers["desktop:file-save"]({ sessionGeneration, handle: h.metadata.handle, dataBase64: Buffer.from("saved").toString("base64") });
  const result = saving.catch((error: unknown) => ({ error }));
  await replaced;
  const closedDuringWrite = h.documents.update({ documentIds: [], activeDocumentId: null });
  release();
  await expect(result).resolves.toMatchObject({ opened: true, metadata: { handle: h.metadata.handle } });
  expect(closedDuringWrite).toBe(false);
  expect(await fs.readFile(h.path, "utf8")).toBe("saved");
  expect(checkpoint).toHaveBeenCalledOnce();
  expect(confirmed).toHaveBeenCalledOnce();
  expect(protectedRow).toBe(false);
  expect(h.documents.update({ documentIds: [], activeDocumentId: null })).toBe(true);
  await expect(h.registry.read(h.metadata.handle)).rejects.toMatchObject({ code: "invalid_handle" });
});

it("releases a local context after a refused save without marking a receipt", async () => {
  const h = await fixture();
  const handlers = createFileIpcHandlers({ registry: h.registry, isOpened: (id) => h.documents.context(id)?.kind === "local", beginSave: h.documents.beginSave, checkpoint: async () => { throw new Error("storage unavailable"); } });
  await expect(handlers["desktop:file-save"]({ sessionGeneration, handle: h.metadata.handle, dataBase64: "YQ==" })).rejects.toThrow();
  expect(h.documents.context(h.metadata.handle)?.lastConfirmedSaveAt).toBe(0);
  expect(h.documents.update({ documentIds: [], activeDocumentId: null })).toBe(true);
});

it("rebinds Save As at eight documents without writing and then reporting a capacity failure", async () => {
  const h = await fixture();
  for (let index = 0; index < 7; index++) h.documents.open(`cloud-${index}`, "cloud", { deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: `cloud-${index}`, base: { revision: "1", version: "1" } });
  const destination = join(h.root, "copy.docx");
  const handlers = createFileIpcHandlers({ registry: h.registry, pickSaveAs: async () => destination, session: () => session, beginSave: h.documents.beginSave, isOpened: (id) => h.documents.context(id)?.kind === "local", onSaveConfirmed: (metadata) => {
    if (!h.documents.open(metadata.handle, "local", localDraftIdentity(session, h.registry.identityFor(metadata.handle), metadata))) throw new Error("document_context_refused");
  }, onSaveAsConfirmed: (previousHandle, metadata) => {
    if (!h.documents.rebindLocal(previousHandle, metadata.handle, localDraftIdentity(session, h.registry.identityFor(metadata.handle), metadata))) throw new Error("document_context_refused");
  } });
  const response = await handlers["desktop:file-save-as"]({ sessionGeneration, handle: h.metadata.handle, dataBase64: Buffer.from("copied").toString("base64") });
  expect(response.opened).toBe(true);
  expect(await fs.readFile(destination, "utf8")).toBe("copied");
  expect(await fs.readFile(h.path, "utf8")).toBe("old");
  expect(h.documents.all()).toHaveLength(8);
  expect(h.documents.context(h.metadata.handle)).toBeUndefined();
  expect(h.documents.context(response.metadata!.handle)?.kind).toBe("local");
  expect(h.documents.activeDocumentId()).toBe(response.metadata!.handle);
  expect(h.registry.size).toBe(1);
});
