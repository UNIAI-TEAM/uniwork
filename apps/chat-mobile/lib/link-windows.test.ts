import { describe, expect, it } from "vitest";
import { linkWindows, taskIdsByMessage } from "./link-windows";

const ulids = (count: number, from = 0) => Array.from({ length: count }, (_, i) => `01JA${String(from + i).padStart(22, "0")}`);
const keys = (windows: string[][]) => windows.map((w) => w.join(","));

describe("linkWindows", () => {
  it("asks for nothing without ids", () => {
    expect(linkWindows([])).toEqual([]);
  });

  it("keeps every id once, in order, in windows of at most 48", () => {
    const ids = ulids(500);
    const windows = linkWindows(ids);
    expect(windows.flat()).toEqual(ids);
    expect(Math.max(...windows.map((w) => w.length))).toBeLessThanOrEqual(48);
    // About one window per sixteen messages, not one per message nor one for all.
    expect(windows.length).toBeGreaterThan(500 / 48);
    expect(windows.length).toBeLessThan(500 / 4);
  });

  it("caps a run of ids none of which ends a window", () => {
    // Ids whose hash never lands on a boundary: the cap closes the window.
    const quiet: string[] = [];
    for (let i = 0; quiet.length < 100; i += 1) {
      const id = `x${i}`;
      if (linkWindows([id, "tail"])[0]!.length === 2) quiet.push(id);
    }
    expect(linkWindows(quiet).map((w) => w.length)).toEqual([48, 48, 4]);
  });

  it("a new message changes the newest window only; an older page leaves the newer windows as they were", () => {
    const ids = ulids(200, 100);
    const before = keys(linkWindows(ids));
    const withNew = keys(linkWindows([...ids, ...ulids(1, 300)]));
    expect(withNew.slice(0, before.length - 1)).toEqual(before.slice(0, -1));
    const withOlder = keys(linkWindows([...ulids(100, 0), ...ids]));
    // Every window after the first boundary inside the visible ids is unchanged.
    expect(withOlder.slice(-(before.length - 1))).toEqual(before.slice(1));
  });
});

describe("taskIdsByMessage", () => {
  const link = (id: string, message_id: string, target_id: string, target_type = "task", relation = "created_from") => ({
    id,
    message_id,
    target_id,
    target_type,
    relation,
  });
  const ref = (taskId: string, linkId: string, relation = "created_from") => ({ taskId, linkId, relation });

  it("reads the tasks of every answered window, several per message, and skips other targets", () => {
    const map = taskIdsByMessage(
      [["a", "b"], ["c"]],
      [[link("l1", "a", "t1"), link("l2", "a", "t2"), link("l3", "b", "d1", "document")], [link("l4", "c", "t3", "task", "mentions")]],
      new Map(),
    );
    expect(Object.fromEntries(map)).toEqual({
      a: [ref("t1", "l1"), ref("t2", "l2")],
      c: [ref("t3", "l4", "mentions")],
    });
  });

  it("a window waiting for its answer keeps what its messages showed; an answered one replaces it", () => {
    const kept = [ref("t1", "l1")];
    const previous = new Map([
      ["a", kept],
      ["c", [ref("t3", "l3")]],
    ]);
    const map = taskIdsByMessage([["a", "b"], ["c", "d"]], [undefined, []], previous);
    expect(Object.fromEntries(map)).toEqual({ a: kept });
    expect(map.get("a")).toBe(kept);
  });

  it("reads a link that names no relation as none", () => {
    const map = taskIdsByMessage([["a"]], [[{ id: "l1", message_id: "a", target_type: "task", target_id: "t1" }]], new Map());
    expect(map.get("a")).toEqual([ref("t1", "l1", "")]);
  });
});
