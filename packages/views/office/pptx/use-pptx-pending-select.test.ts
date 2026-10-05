import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PptxNodeBox } from "./canvas/render-tree";
import { box } from "./canvas/pptx-render-fixtures";
import { usePptxPendingSelect, type PptxCreatedBaseline } from "./use-pptx-pending-select";

const node = (sourceId: string): PptxNodeBox => ({ sourceId, type: "shape", box: box() });

interface Props {
  slideIndex: number;
  revision: number | undefined;
  boxes: readonly PptxNodeBox[];
  ready: boolean;
  selectedIds: readonly string[];
}

function setup(initial: Partial<Props> = {}) {
  const select = vi.fn();
  const props: Props = { slideIndex: 0, revision: 1, boxes: [node("a")], ready: true, selectedIds: ["a"], ...initial };
  const view = renderHook((p: Props) => usePptxPendingSelect({ ...p, select }), { initialProps: props });
  return {
    select,
    created: (ids: readonly string[], requestedAt?: PptxCreatedBaseline) => act(() => view.result.current(ids, requestedAt)),
    update: (next: Partial<Props>) => view.rerender({ ...props, ...next }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("usePptxPendingSelect (UNI-927 W10a, W9 review F1)", () => {
  it("selects the minted ids once the edit's rendition mounts them", () => {
    const { select, created, update } = setup();
    created(["new"]);
    expect(select).not.toHaveBeenCalled();
    update({ revision: 2, boxes: [node("a"), node("new")] });
    expect(select).toHaveBeenCalledExactlyOnceWith(["new"]);
  });

  it("drops the wait when the user changes slide, even onto a slide with the same id", () => {
    const { select, created, update } = setup();
    created(["new"]);
    update({ slideIndex: 1, revision: 2, boxes: [node("new")] });
    update({ slideIndex: 0, revision: 2, boxes: [node("new")] });
    expect(select).not.toHaveBeenCalled();
  });

  it("drops the wait when the user makes another selection meanwhile", () => {
    const { select, created, update } = setup();
    created(["new"]);
    update({ selectedIds: [] });
    update({ selectedIds: [], revision: 2, boxes: [node("a"), node("new")] });
    expect(select).not.toHaveBeenCalled();
  });

  it("selects on the normal path with a request-time stamp equal to the current state (W10 review F3)", () => {
    const { select, created, update } = setup();
    created(["new"], { slideIndex: 0, selectedIds: ["a"] });
    update({ revision: 2, boxes: [node("a"), node("new")] });
    expect(select).toHaveBeenCalledExactlyOnceWith(["new"]);
  });

  it("drops the wait when the slide changed while the edit was in flight (W10 review F3)", () => {
    // The user is already on slide 1 when the edit (sent on slide 0) resolves.
    const { select, created, update } = setup({ slideIndex: 1 });
    created(["new"], { slideIndex: 0, selectedIds: ["a"] });
    update({ slideIndex: 1, revision: 2, boxes: [node("a"), node("new")] });
    expect(select).not.toHaveBeenCalled();
  });

  it("drops the wait when the selection changed while the edit was in flight (W10 review F3)", () => {
    const { select, created, update } = setup({ selectedIds: ["b"] });
    created(["new"], { slideIndex: 0, selectedIds: ["a"] });
    update({ selectedIds: ["b"], revision: 2, boxes: [node("a"), node("new")] });
    expect(select).not.toHaveBeenCalled();
  });

  it("drops the wait when a newer rendition mounts without the ids", () => {
    const { select, created, update } = setup();
    created(["new"]);
    update({ revision: 2, boxes: [node("a")] });
    update({ revision: 3, boxes: [node("a"), node("new")] });
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps waiting while the next rendition is still building", () => {
    const { select, created, update } = setup();
    created(["new"]);
    update({ revision: 2, ready: false, boxes: [] });
    update({ revision: 2, ready: true, boxes: [node("new")] });
    expect(select).toHaveBeenCalledExactlyOnceWith(["new"]);
  });

  it("expires after a short timeout when the revision never moves", () => {
    vi.useFakeTimers();
    const { select, created, update } = setup({ revision: undefined });
    created(["new"]);
    act(() => { vi.advanceTimersByTime(2500); });
    update({ boxes: [node("a"), node("new")] });
    expect(select).not.toHaveBeenCalled();
  });
});
