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
});
