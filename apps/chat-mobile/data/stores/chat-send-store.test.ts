import { beforeEach, describe, expect, it } from "vitest";
import type { PendingSend } from "@/lib/send-pipeline";
import { installDeviceStore, memoryDeviceStore, openDeviceStore } from "../storage/device-store";
import { hydrateChatSendStore, rehydratedEntries, selectQueuedRoomIds, useChatSendStore } from "./chat-send-store";

const entry = (clientMsgId: string, extra: Partial<PendingSend> = {}): PendingSend => ({
  workspaceId: "w1",
  roomId: "r1",
  senderId: "u1",
  clientMsgId,
  body: clientMsgId,
  createdAt: 1,
  status: "queued",
  ...extra,
});

beforeEach(() => {
  installDeviceStore(async () => memoryDeviceStore());
  useChatSendStore.getState().clear();
});

describe("chat send store", () => {
  it("keeps one entry per client_msg_id and moves only the named one's status and file; nothing reaches the disk before the boot read", async () => {
    const disk = memoryDeviceStore();
    installDeviceStore(async () => disk);
    const store = useChatSendStore.getState();
    store.upsert(entry("a"));
    store.upsert(entry("b"));
    store.upsert({ ...entry("a"), body: "again" });
    useChatSendStore.getState().setStatus("a", "failed");
    useChatSendStore.getState().setFile("b", { uri: "file:///outbox/b/x.png", name: "x.png" });
    expect(useChatSendStore.getState().entries.map((e) => [e.clientMsgId, e.status, e.body, e.file?.uri])).toEqual([
      ["b", "queued", "b", "file:///outbox/b/x.png"],
      ["a", "failed", "again", undefined],
    ]);
    useChatSendStore.getState().remove("b");
    expect(useChatSendStore.getState().entries.map((e) => e.clientMsgId)).toEqual(["a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The queue on disk would have been replaced by this launch's empty one.
    expect(disk.getString("chat-send-outbox")).toBeUndefined();
  });

  it("survives the process: read back at boot with nothing left 'sending', then written on every change", async () => {
    const disk = memoryDeviceStore();
    const stored = [entry("a", { status: "sending" }), entry("b", { status: "failed" })];
    disk.set("chat-send-outbox", JSON.stringify({ state: { entries: stored }, version: 1 }));
    installDeviceStore(async () => disk);
    useChatSendStore.setState({ entries: [entry("typed-before-the-read")] });
    await hydrateChatSendStore();
    expect(useChatSendStore.getState().entries.map((e) => [e.clientMsgId, e.status])).toEqual([
      ["a", "queued"],
      ["b", "failed"],
      ["typed-before-the-read", "queued"],
    ]);

    useChatSendStore.getState().remove("a");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(disk.getString("chat-send-outbox")!).state.entries.map((e: PendingSend) => e.clientMsgId)).toEqual(["b", "typed-before-the-read"]);
  });

  it("a first launch, or a store that never persisted, starts empty", async () => {
    installDeviceStore(async () => memoryDeviceStore());
    await openDeviceStore();
    await hydrateChatSendStore();
    expect(useChatSendStore.getState().entries).toEqual([]);
  });

  it("reads back only entries a send can use", () => {
    expect(rehydratedEntries(undefined)).toEqual([]);
    expect(rehydratedEntries("garbage")).toEqual([]);
    expect(
      rehydratedEntries([
        null,
        "x",
        { ...entry("no-room"), roomId: "" },
        { ...entry("no-body"), body: 1 },
        { ...entry("no-time"), createdAt: "1" },
        { ...entry("odd-status"), status: "sent" },
        entry("ok"),
        entry("sending", { status: "sending" }),
      ]).map((e) => [e.clientMsgId, e.status]),
    ).toEqual([
      ["ok", "queued"],
      ["sending", "queued"],
    ]);
  });
});

describe("selectQueuedRoomIds", () => {
  it("names the rooms with a queued message of this sender in this workspace", () => {
    const entries = [
      entry("a"),
      entry("b", { roomId: "r2", status: "sending" }),
      entry("c", { roomId: "r3", workspaceId: "w2" }),
      entry("d", { roomId: "r4", senderId: "someone-else" }),
      entry("e", { roomId: "r5" }),
    ];
    expect([...selectQueuedRoomIds(entries, "w1", "u1")].sort()).toEqual(["r1", "r5"]);
  });
});
