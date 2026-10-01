import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDesktopDraftStore } from "./store";
import { createFakeDraftKeyStore } from "./test-fake";
import { readDraftEnvelope } from "./migration";

const identity = { deploymentId: "dep", accountId: "a", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "r1", version: "v1" } };
const session = { sessionId: "session-a", deploymentId: "dep", accountId: "a", generation: 1 };
async function fixture() {
  const root = resolve(".test-artifacts", "draft-migration", crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const keyStore = createFakeDraftKeyStore();
  const store = createDesktopDraftStore({ rootDirectory: root, keyStore });
  const plaintext = Buffer.from("unsaved draft survives upgrade and rollback");
  await store.checkpointPlaintext({ session, identity, draftId: "d1", generation: 1, plaintext });
  const namespace = (await fs.readdir(root))[0]!;
  const rowPath = join(root, namespace, (await fs.readdir(join(root, namespace)))[0]!);
  return { root, keyStore, store, plaintext, rowPath };
}

describe("actual desktop draft format migration", () => {
  it("reads v1 then v2 then rollback v1 with the same ciphertext and key namespace", async () => {
    const f = await fixture();
    const original = readDraftEnvelope(JSON.parse(await fs.readFile(f.rowPath, "utf8")));
    const keyRead = vi.spyOn(f.keyStore, "getOrCreate");
    for (const version of [2, 1] as const) {
      await f.store.migrateFormat(version);
      expect(keyRead).not.toHaveBeenCalled();
      const migrated = readDraftEnvelope(JSON.parse(await fs.readFile(f.rowPath, "utf8")));
      expect(migrated).toMatchObject({ version, ciphertext: original.ciphertext, nonce: original.nonce, checksum: original.checksum, identity: original.identity });
      const restarted = createDesktopDraftStore({ rootDirectory: f.root, keyStore: f.keyStore });
      const recovery = await restarted.recoverPlaintext({ session, lookup: identity, currentBase: identity.base, liveAccess: "edit" });
      expect(recovery.status).toBe("recovered");
      if (recovery.status === "recovered") expect(Buffer.from(recovery.plaintext)).toEqual(f.plaintext);
      keyRead.mockClear();
    }
    const retained = `${f.rowPath}.v1.1.${createHash("sha256").update(original.ciphertext).digest("hex")}.keep`;
    expect(readDraftEnvelope(JSON.parse(await fs.readFile(retained, "utf8"))).ciphertext).toBe(original.ciphertext);
    expect(JSON.parse(await fs.readFile(f.rowPath, "utf8"))).not.toHaveProperty("format");
    keyRead.mockRestore();
  });
  it("retains original durable bytes if migration fails", async () => {
    const f = await fixture();
    const before = await fs.readFile(f.rowPath, "utf8");
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("disk failure"));
    await expect(f.store.migrateFormat(2)).rejects.toMatchObject({ code: "storage_unavailable" });
    rename.mockRestore();
    expect(await fs.readFile(f.rowPath, "utf8")).toBe(before);
  });
  it("refuses unsupported records without hiding or deleting them", async () => {
    const f = await fixture();
    const original = JSON.parse(await fs.readFile(f.rowPath, "utf8"));
    const invalid = JSON.stringify({ ...original, version: 99 });
    await fs.writeFile(f.rowPath, invalid);
    await expect(f.store.list({ session, lookup: identity })).rejects.toMatchObject({ code: "draft_recovery_locked" });
    await expect(f.store.migrateFormat(2)).rejects.toMatchObject({ code: "draft_recovery_locked" });
    expect(await fs.readFile(f.rowPath, "utf8")).toBe(invalid);
  });
});
