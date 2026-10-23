import { beforeEach, describe, expect, it } from "vitest";
import { DRAFT_TTL_MS } from "@/lib/drafts";
import { installDeviceStore, memoryDeviceStore } from "../storage/device-store";
import { hydrateDraftStore, readDraft, useDraftStore } from "./draft-store";

const reply = { id: "m1", sender: "Bình", text: "Mai họp nhé" };

beforeEach(() => useDraftStore.getState().clearAll());

describe("draft store", () => {
  it("keeps text and a quote per composer, drops an emptied draft, and clears one sent", () => {
    const store = useDraftStore.getState();
    store.setText("k1", "đang viết");
    store.setReply("k1", reply);
    expect(readDraft("k1")).toMatchObject({ text: "đang viết", reply });
    store.setText("k1", "đang viết");
    store.setReply("k1", reply);
    store.setReply("k1", null);
    expect(readDraft("k1")).toMatchObject({ text: "đang viết" });
    expect(readDraft("k1")?.reply).toBeUndefined();
    store.setText("k1", "");
    expect(readDraft("k1")).toBeUndefined();
    store.setReply("k2", reply);
    expect(readDraft("k2")).toMatchObject({ text: "", reply });
    store.clear("k2");
    store.clear("k2");
    expect(useDraftStore.getState().drafts).toEqual({});
  });

  it("writes nothing before the boot read, then survives the process; a stale or broken draft is dropped", async () => {
    const disk = memoryDeviceStore();
    installDeviceStore(async () => disk);
    useDraftStore.getState().setText("early", "trước khi đọc");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disk.getString("chat-drafts")).toBeUndefined();
    disk.set(
      "chat-drafts",
      JSON.stringify({
        state: { drafts: { kept: { text: "giữ", updatedAt: Date.now() }, stale: { text: "cũ", updatedAt: Date.now() - DRAFT_TTL_MS - 1 }, broken: { text: 1 } } },
        version: 1,
      }),
    );
    await hydrateDraftStore();
    expect(Object.keys(useDraftStore.getState().drafts).sort()).toEqual(["early", "kept"]);
    useDraftStore.getState().clear("early");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Object.keys(JSON.parse(disk.getString("chat-drafts") ?? "{}").state.drafts)).toEqual(["kept"]);
  });

  it("reads a state an older or newer build wrote through the same schema", () => {
    const { migrate } = useDraftStore.persist.getOptions();
    expect(migrate?.({ drafts: { a: { text: "x", updatedAt: Date.now() } } }, 0)).toEqual({ drafts: { a: expect.objectContaining({ text: "x" }) } });
    expect(migrate?.(null, 2)).toEqual({ drafts: {} });
  });
});
