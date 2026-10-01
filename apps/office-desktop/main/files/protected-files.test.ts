import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { expect, it, vi } from "vitest";
import { createDesktopDraftStore } from "../drafts/store";
import { createFakeDraftKeyStore } from "../drafts/test-fake";
import { createProtectedFileCheckpoints, discardProtectedCheckpoint } from "./protected-files";

const metadata = { handle: `file_${"x".repeat(40)}`, name: "Local.docx", byteLength: 19, modifiedAtMs: 1, checksum: `sha256:${"a".repeat(64)}` };
const scope = () => ({ sessionId: "session_1234", accountId: "account", deploymentId: "lane", generation: 1 });
const stableId = "local:stable-file-identity";

async function tempStore() {
  const parent = resolve(process.cwd(), "../../.uniwork-dev-run/local-draft-tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "case-"));
  const keyStore = createFakeDraftKeyStore();
  const store = createDesktopDraftStore({ rootDirectory: join(root, "drafts"), keyStore });
  return { root, keyStore, store };
}

it("writes a local snapshot as an encrypted row in the shared draft store", async () => {
  const { root, keyStore, store } = await tempStore();
  const getOrCreate = vi.spyOn(keyStore, "getOrCreate");
  const checkpoint = createProtectedFileCheckpoints({ store, scope, identityFor: () => stableId });
  await checkpoint(metadata, new TextEncoder().encode("private draft text"));
  expect(getOrCreate).toHaveBeenCalledOnce();
  const namespaces = await fs.readdir(join(root, "drafts"));
  const files = await fs.readdir(join(root, "drafts", namespaces[0]!));
  const snapshot = await fs.readFile(join(root, "drafts", namespaces[0]!, files[0]!), "utf8");
  expect(snapshot).not.toContain("private draft text");
  expect(JSON.parse(snapshot)).toMatchObject({ encrypted: true, generation: 1 });
  await expect(store.list({ session: scope(), lookup: { deploymentId: "lane", accountId: "account", organizationId: "local", workspaceId: "local", documentId: stableId } })).resolves.toHaveLength(1);
});

it("keeps the generation monotonic across restarts and recovers through the same store", async () => {
  const { store } = await tempStore();
  const first = createProtectedFileCheckpoints({ store, scope, identityFor: () => stableId });
  const ref = await first(metadata, new TextEncoder().encode("first"));
  expect(ref.draftId.startsWith(stableId)).toBe(true);
  const restarted = createProtectedFileCheckpoints({ store, scope, identityFor: () => stableId });
  await restarted(metadata, new TextEncoder().encode("second"));
  const listed = await store.list({ session: scope(), lookup: { deploymentId: "lane", accountId: "account", organizationId: "local", workspaceId: "local", documentId: stableId } });
  expect(listed).toHaveLength(1);
  expect(listed[0]!.draftId.startsWith(stableId)).toBe(true);
  await expect(store.recoverPlaintext({ session: scope(), lookup: { deploymentId: "lane", accountId: "account", organizationId: "local", workspaceId: "local", documentId: stableId, draftId: listed[0]!.draftId }, currentBase: { version: metadata.checksum, revision: String(metadata.modifiedAtMs) }, liveAccess: "edit" })).resolves.toMatchObject({ status: "recovered", metadata: { generation: 2 } });
});

it("consumes exactly the checkpoint a confirmed write superseded", async () => {
  const { store } = await tempStore();
  const checkpoint = createProtectedFileCheckpoints({ store, scope, identityFor: () => stableId });
  const ref = await checkpoint(metadata, new TextEncoder().encode("pre-write"));
  await discardProtectedCheckpoint(store, scope(), ref);
  await expect(store.list({ session: scope(), lookup: { deploymentId: "lane", accountId: "account", organizationId: "local", workspaceId: "local", documentId: stableId } })).resolves.toEqual([]);
  // A different (still pending) base is untouched.
  const other = await checkpoint({ ...metadata, modifiedAtMs: 2, checksum: `sha256:${"b".repeat(64)}` }, new TextEncoder().encode("other"));
  await discardProtectedCheckpoint(store, scope(), ref);
  await expect(store.list({ session: scope(), lookup: { deploymentId: "lane", accountId: "account", organizationId: "local", workspaceId: "local", documentId: stableId } })).resolves.toHaveLength(1);
  expect(other.draftId).not.toBe(ref.draftId);
});

it("refuses a local snapshot if the OS key store is locked and writes nothing", async () => {
  const parent = resolve(process.cwd(), "../../.uniwork-dev-run/local-draft-tests");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "locked-"));
  const keyStore = {
    async get() { return undefined; },
    async getOrCreate() { throw Object.assign(new Error("draft key store is locked"), { code: "locked" }); },
  };
  const store = createDesktopDraftStore({ rootDirectory: join(root, "drafts"), keyStore });
  const checkpoint = createProtectedFileCheckpoints({ store, scope, identityFor: () => stableId });
  await expect(checkpoint(metadata, new Uint8Array([1, 2]))).rejects.toMatchObject({ code: "draft_recovery_locked" });
  // The store root may exist, but no namespace/row may have been written.
  await expect(fs.readdir(join(root, "drafts"))).resolves.toEqual([]);
});
