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
        // Nested fields are read too: a file without its path, a voice clip without the file, a reminder that repeats oddly.
        entry("no-uri", { file: { uri: "", name: "x.png" } }),
        { ...entry("voice-no-clip"), voiceDurationMs: 1200 },
        { ...entry("odd-repeat"), reminder: { body: "", remindAt: "2026-10-22T09:00:00Z", repeat: "hourly" } },
        entry("ok"),
        entry("sending", { status: "sending" }),
        entry("voice", { file: { uri: "file:///outbox/voice/clip.m4a", name: "clip.m4a", mimeType: "audio/mp4", size: 10 }, voiceDurationMs: 1200 }),
        entry("reminder", { body: "", reminder: { body: "call", remindAt: "2026-10-22T09:00:00Z", repeat: "weekly" } }),
      ]).map((e) => [e.clientMsgId, e.status]),
    ).toEqual([
      ["ok", "queued"],
      ["sending", "queued"],
      ["voice", "queued"],
      ["reminder", "queued"],
    ]);
    // A message failing for its own reason keeps its count across a restart (lib/delivery-failure.ts).
    expect(rehydratedEntries([entry("poison", { failures: 3 }), { ...entry("odd-count"), failures: 1.5 }]).map((e) => [e.clientMsgId, e.failures])).toEqual([
      ["poison", 3],
    ]);
  });

  // Android's document picker hands JS `null` for a type or size the provider does not know, and an
  // outbox written by an earlier build may hold it: the message must survive the restart, not vanish.
  it("reads back a queued file whose type and size were written as null", async () => {
    // Cleared first: a store already hydrated writes through, and would empty the disk.
    useChatSendStore.getState().clear();
    const disk = memoryDeviceStore();
    const file = { uri: "file:///outbox/doc/bao-gia.pdf", name: "bao-gia.pdf", mimeType: null, size: null };
    disk.set("chat-send-outbox", JSON.stringify({ state: { entries: [{ ...entry("doc"), file }] }, version: 1 }));
    installDeviceStore(async () => disk);
    await hydrateChatSendStore();
    expect(useChatSendStore.getState().entries.map((e) => [e.clientMsgId, e.file])).toEqual([
      ["doc", { uri: "file:///outbox/doc/bao-gia.pdf", name: "bao-gia.pdf" }],
    ]);
  });

  // zustand without a migrate drops the whole state when the stored version differs: unsent messages lost.
  it("a queue written by an older or a newer build (an OTA rolled back) still loads", async () => {
    for (const version of [0, 2]) {
      // Cleared first: a store already hydrated writes through, and would empty the disk.
      useChatSendStore.getState().clear();
      const disk = memoryDeviceStore();
      disk.set("chat-send-outbox", JSON.stringify({ state: { entries: [entry("kept", { status: "sending" }), { ...entry("bad"), roomId: 1 }] }, version }));
      installDeviceStore(async () => disk);
      await hydrateChatSendStore();
      expect(useChatSendStore.getState().entries.map((e) => [e.clientMsgId, e.status])).toEqual([["kept", "queued"]]);
    }
    useChatSendStore.getState().clear();
    const disk = memoryDeviceStore();
    disk.set("chat-send-outbox", JSON.stringify({ state: "garbage", version: 0 }));
    installDeviceStore(async () => disk);
    await hydrateChatSendStore();
    expect(useChatSendStore.getState().entries).toEqual([]);
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
