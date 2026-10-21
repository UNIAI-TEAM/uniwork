import { beforeEach, describe, expect, it } from "vitest";
import { installDeviceStore, memoryDeviceStore } from "../storage/device-store";
import { hydratePendingOpsStore, rehydratedOps, usePendingOpsStore, type PendingOp } from "./pending-ops-store";

const read = (key: string, extra: Partial<PendingOp> = {}): PendingOp =>
  ({ kind: "read", key, workspaceId: "w1", roomId: "r1", userId: "u1", createdAt: 1, rev: 1, verify: false, ...extra }) as PendingOp;

beforeEach(() => usePendingOpsStore.getState().clear());

describe("pending ops store", () => {
  it("keeps one entry per thing, the last wish winning; nothing reaches the disk before the boot read", async () => {
    const disk = memoryDeviceStore();
    installDeviceStore(async () => disk);
    const store = usePendingOpsStore.getState();
    store.put(read("a"));
    store.put(read("b"));
    store.put(read("a", { rev: 2 }));
    usePendingOpsStore.getState().update("b", { verify: true });
    expect(usePendingOpsStore.getState().ops.map((op) => [op.key, op.rev, op.verify])).toEqual([
      ["b", 1, true],
      ["a", 2, false],
    ]);
    usePendingOpsStore.getState().remove("b");
    expect(usePendingOpsStore.getState().ops.map((op) => op.key)).toEqual(["a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disk.getString("chat-pending-ops")).toBeUndefined();
  });

  it("survives the process; a reaction or vote read back is verified against the server before it toggles", async () => {
    const disk = memoryDeviceStore();
    const reaction = { ...read("x"), kind: "reaction", messageId: "m1", emoji: "👍", on: true, base: false, rev: 4 };
    disk.set("chat-pending-ops", JSON.stringify({ state: { ops: [read("r"), reaction] }, version: 1 }));
    installDeviceStore(async () => disk);
    await hydratePendingOpsStore();
    expect(usePendingOpsStore.getState().ops.map((op) => [op.key, op.rev, op.verify])).toEqual([
      ["r", 0, false],
      ["x", 0, true],
    ]);
    usePendingOpsStore.getState().remove("r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(disk.getString("chat-pending-ops")!).state.ops.map((op: PendingOp) => op.key)).toEqual(["x"]);
  });

  it("reads back only entries a delivery can use", () => {
    expect(rehydratedOps(undefined)).toEqual([]);
    expect(rehydratedOps({})).toEqual([]);
    const vote = { ...read("v"), kind: "vote", messageId: "m1", optionIds: ["a"], base: [] };
    expect(
      rehydratedOps([
        null,
        1,
        read(""),
        { ...read("t"), createdAt: "1" },
        { ...read("k"), kind: "edit" },
        { ...read("bad-reaction"), kind: "reaction", messageId: "m1", emoji: "👍" },
        { ...read("bad-vote"), kind: "vote", messageId: "m1" },
        { ...read("vote-no-base"), kind: "vote", messageId: "m1", optionIds: ["a"] },
        { ...read("vote-odd-option"), kind: "vote", messageId: "m1", optionIds: [1], base: [] },
        { ...read("reaction-no-base"), kind: "reaction", messageId: "m1", emoji: "👍", on: true },
        vote,
      ]).map((op) => op.key),
    ).toEqual(["v"]);
  });

  it("a queue written by an older or a newer build (an OTA rolled back) still loads", async () => {
    for (const version of [0, 2]) {
      // Cleared first: a store already hydrated writes through, and would empty the disk.
      usePendingOpsStore.getState().clear();
      const disk = memoryDeviceStore();
      disk.set("chat-pending-ops", JSON.stringify({ state: { ops: [read("kept"), { ...read("bad"), kind: "edit" }] }, version }));
      installDeviceStore(async () => disk);
      await hydratePendingOpsStore();
      expect(usePendingOpsStore.getState().ops.map((op) => [op.key, op.rev])).toEqual([["kept", 0]]);
    }
  });
});
