import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopDraftStore } from "./store";
import { createFakeDraftKeyStore } from "./test-fake";
import { restartToUpdate } from "../updates/restart";

const identity = { deploymentId: "dep", accountId: "a", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "r1", version: "v1" } };
const session = { sessionId: "s", deploymentId: "dep", accountId: "a", generation: 1 };
const input = { session, identity, draftId: "draft", generation: 1, plaintext: Buffer.from("checkpoint") };
async function fixture() {
  const rootDirectory = resolve(".test-artifacts", "restart", crypto.randomUUID());
  await fs.mkdir(rootDirectory, { recursive: true });
  return createDesktopDraftStore({ rootDirectory, keyStore: createFakeDraftKeyStore() });
}
afterEach(() => { vi.useRealTimers(); });

describe("restart with the real protected draft store", () => {
  it("flushes multiple documents and blocks changes during confirmation", async () => {
    const store = await fixture();
    store.scheduleCheckpoint(input, true);
    store.scheduleCheckpoint({ ...input, identity: { ...identity, documentId: "other" }, draftId: "other" }, true);
    const restart = vi.fn();
    await restartToUpdate({ drafts: store, confirmDrafts: async () => {
      expect(await store.list({ session })).toHaveLength(2);
      await expect(store.checkpointPlaintext({ ...input, generation: 2 })).rejects.toMatchObject({ code: "storage_unavailable" });
      return true;
    }, restart });
    expect(restart).toHaveBeenCalledOnce();
  });
  it("retains background IO failures so restart cannot silently succeed", async () => {
    const store = await fixture();
    vi.useFakeTimers();
    store.failNextCheckpoint();
    store.scheduleCheckpoint(input, true);
    await vi.advanceTimersByTimeAsync(2001);
    vi.useRealTimers();
    const restart = vi.fn();
    await expect(restartToUpdate({ drafts: store, confirmDrafts: async () => true, restart })).rejects.toMatchObject({ code: "checkpoint_failed" });
    expect(restart).not.toHaveBeenCalled();
    store.scheduleCheckpoint({ ...input, generation: 2 }, true);
    await store.flushScheduled();
    expect(await store.list({ session })).toHaveLength(1);
  });
  it("reopens writes after cancellation", async () => {
    const store = await fixture();
    store.scheduleCheckpoint(input, true);
    await expect(restartToUpdate({ drafts: store, confirmDrafts: async () => false, restart: vi.fn() })).rejects.toMatchObject({ code: "confirmation_required" });
    await expect(store.checkpointPlaintext({ ...input, generation: 2 })).resolves.toMatchObject({ generation: 2 });
  });
});
