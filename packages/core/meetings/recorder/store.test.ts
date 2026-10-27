import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { IDBDatabase, IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryRecordingStore, openRecordingStore, type RecordingPart, type RecordingStore } from "./store";
import { useUnsentRecordings } from "./use-meeting-recorder";

beforeEach(() => {
  // jsdom has no IndexedDB globals; the store builds its key ranges from the global one.
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});

const part = (over: Partial<RecordingPart>): RecordingPart => ({
  id: "p1", userId: "u1", meetingId: "m1", startedAt: 1_000, lastChunkAt: 1_000, endedAt: null,
  mimeType: "audio/webm", bytes: 0, language: "vi", offsetSeconds: 0, ...over,
});

async function text(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await blob.arrayBuffer());
}

describe.each<[string, () => RecordingStore]>([
  ["indexeddb", () => openRecordingStore(new IDBFactory())],
  ["memory", memoryRecordingStore],
])("%s recording store", (_name, make) => {
  it("store keeps parts per user and reads chunks in order", async () => {
    const store = make();
    await store.createPart(part({ id: "b", startedAt: 2_000 }));
    await store.createPart(part({ id: "a", startedAt: 1_000 }));
    await store.createPart(part({ id: "c", userId: "u2" }));
    await store.createPart(part({ id: "d", meetingId: "m2", startedAt: 3_000 }));
    // Out of order on purpose: the part reads back by seq, not by arrival.
    await store.appendChunk("a", 2, new Blob(["three"]), 1_300);
    await store.appendChunk("a", 0, new Blob(["one-"]), 1_100);
    await store.appendChunk("a", 1, new Blob(["two-"]), 1_200);

    expect((await store.listParts("u1")).map((p) => p.id)).toEqual(["a", "b", "d"]);
    expect((await store.listParts("u1", "m1")).map((p) => p.id)).toEqual(["a", "b"]);
    expect((await store.listParts("u2")).map((p) => p.id)).toEqual(["c"]);

    const blob = await store.readPart("a");
    expect(blob.type).toBe("audio/webm");
    expect(await text(blob)).toBe("one-two-three");
    const [a] = await store.listParts("u1", "m1");
    expect(a).toMatchObject({ bytes: 13, lastChunkAt: 1_300, endedAt: null });

    await store.finishPart("a", 1_500);
    expect((await store.listParts("u1", "m1"))[0]?.endedAt).toBe(1_500);

    await store.deletePart("a");
    expect((await store.listParts("u1", "m1")).map((p) => p.id)).toEqual(["b"]);
    await expect(store.readPart("a")).rejects.toThrow();
    // The chunks went with the part: a new part under the same id starts empty.
    await store.createPart(part({ id: "a" }));
    expect((await store.readPart("a")).size).toBe(0);
  });
});

describe("indexeddb recording store", () => {
  it("the store reopens after its connection is lost", async () => {
    const store = openRecordingStore(new IDBFactory());
    const opened = vi.spyOn(IDBDatabase.prototype, "transaction");
    await store.createPart(part({ id: "a" }));
    // What iOS does to a backgrounded page: the connection is gone under the store.
    (opened.mock.contexts[0] as IDBDatabase).close();
    opened.mockRestore();

    await store.appendChunk("a", 0, new Blob(["kept"]), 2_000);
    expect(await text(await store.readPart("a"))).toBe("kept");
  });
});

describe("useUnsentRecordings", () => {
  it("adds up the recorded seconds and the last save", async () => {
    const store = memoryRecordingStore();
    await store.createPart(part({ id: "a", startedAt: 0, lastChunkAt: 40_000, endedAt: 60_000 }));
    await store.createPart(part({ id: "b", startedAt: 90_000, lastChunkAt: 120_000 }));
    await store.createPart(part({ id: "c", meetingId: "m2", startedAt: 0, lastChunkAt: 5_000 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useUnsentRecordings("u1", "m1", store), { wrapper });
    await waitFor(() => expect(result.current.parts).toHaveLength(2));
    expect(result.current.seconds).toBe(90);
    expect(result.current.savedAt).toBe(120_000);

    await store.deletePart("a");
    result.current.refresh();
    await waitFor(() => expect(result.current.parts).toHaveLength(1));
    expect(result.current.seconds).toBe(30);
  });

  it("leaves out a part another tab is still writing, and discards only the rest", async () => {
    const store = memoryRecordingStore();
    const now = Date.now();
    await store.createPart(part({ id: "a", startedAt: now - 600_000, lastChunkAt: now - 540_000, endedAt: now - 540_000 }));
    // Open but quiet for 20 s: the tab that wrote it is gone.
    await store.createPart(part({ id: "b", startedAt: now - 500_000, lastChunkAt: now - 20_000 }));
    // Open and written 3 s ago: another tab is recording it.
    await store.createPart(part({ id: "c", startedAt: now - 10_000, lastChunkAt: now - 3_000 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useUnsentRecordings("u1", "m1", store), { wrapper });
    await waitFor(() => expect(result.current.parts).toHaveLength(3));
    expect(result.current.seconds).toBe(540);
    expect(result.current.savedAt).toBe(now - 20_000);

    await result.current.discard();
    expect((await store.listParts("u1", "m1")).map((p) => p.id)).toEqual(["c"]);
    await waitFor(() => expect(result.current.parts.map((p) => p.id)).toEqual(["c"]));
    expect(result.current.savedAt).toBeNull();
  });

  it("has nothing without a user", () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useUnsentRecordings(undefined, "m1", memoryRecordingStore()), { wrapper });
    expect(result.current).toMatchObject({ parts: [], seconds: 0, savedAt: null });
  });
});
