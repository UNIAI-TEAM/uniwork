import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  resetFolderAccessBatches,
  useFolderAccessBatchStore,
  useTrackedFolderAccessBatches,
} from "./folder-access-batches";

const batch = (batchId: string, wsId = "ws1") => ({ wsId, folderId: "f1", batchId });

describe("folder access batch store", () => {
  beforeEach(() => resetFolderAccessBatches());

  it("keeps one entry per workspace and batch id however often it is handed over", () => {
    const { track } = useFolderAccessBatchStore.getState();
    track(batch("b1"));
    track(batch("b1"));
    track(batch("b1", "ws2"));
    expect(useFolderAccessBatchStore.getState().batches.map((b) => `${b.wsId}/${b.batchId}`)).toEqual(["ws1/b1", "ws2/b1"]);
  });

  it("refuses a batch that already settled, so a late hand-over cannot toast twice", () => {
    const { track, settle } = useFolderAccessBatchStore.getState();
    track(batch("b1"));
    settle("ws1", "b1");
    track(batch("b1"));
    expect(useFolderAccessBatchStore.getState().batches).toEqual([]);
  });

  it("lists only the batches of the asked workspace, with a stable result while nothing changes", () => {
    const { track } = useFolderAccessBatchStore.getState();
    track(batch("b1"));
    track(batch("b2", "ws2"));
    const { result, rerender } = renderHook(() => useTrackedFolderAccessBatches("ws1"));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(first.map((b) => b.batchId)).toEqual(["b1"]);
  });

  it("drops the shown mark of a batch that settles", () => {
    const { track, show, settle } = useFolderAccessBatchStore.getState();
    track(batch("b1"));
    show("ws1", "b1");
    settle("ws1", "b1");
    expect(useFolderAccessBatchStore.getState().shown).toEqual([]);
  });

  it("marks the batch shown in the same update that tracks it, so no reader sees it tracked but not shown", () => {
    const seen: { batches: number; shown: number }[] = [];
    const unsubscribe = useFolderAccessBatchStore.subscribe((state) => seen.push({ batches: state.batches.length, shown: state.shown.length }));
    useFolderAccessBatchStore.getState().track(batch("b1"), { shown: true });
    unsubscribe();
    expect(seen).toEqual([{ batches: 1, shown: 1 }]);
  });

  it("does not mark a batch shown that was refused as already settled", () => {
    const { track, settle } = useFolderAccessBatchStore.getState();
    track(batch("b1"));
    settle("ws1", "b1");
    track(batch("b1"), { shown: true });
    expect(useFolderAccessBatchStore.getState().shown).toEqual([]);
  });

  it("marks an already tracked batch shown when a dialog hands it over again", () => {
    const { track } = useFolderAccessBatchStore.getState();
    track(batch("b1"));
    track(batch("b1"), { shown: true });
    const { batches, shown } = useFolderAccessBatchStore.getState();
    expect(batches).toHaveLength(1);
    expect(shown).toHaveLength(1);
  });
});
