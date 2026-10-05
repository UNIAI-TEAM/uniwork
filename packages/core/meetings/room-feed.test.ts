import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { MeetingFeedPage, MeetingFeedQuery } from "../api/endpoints/meetings-feed";
import {
  addMeetingFeedRow,
  mergeFeedRows,
  readMeetingFeed,
  readOlderMeetingFeed,
  type MeetingFeed,
  type MeetingFeedSpec,
} from "./room-feed";

type Row = { id: string; at: number };
const rows = { id: (r: Row) => r.id, compare: (a: Row, b: Row) => a.at - b.at || a.id.localeCompare(b.id) };
const r = (id: string, at: number): Row => ({ id, at });
const ids = (list: Row[]) => list.map((x) => x.id);
const key = ["feed", "m1"];

function page(items: Row[], more: Partial<MeetingFeedPage<Row>> = {}): MeetingFeedPage<Row> {
  return { items, olderCursor: "", afterCursor: "", hasMoreAfter: false, ...more };
}

function specWith(...pages: MeetingFeedPage<Row>[]) {
  const fetch = vi.fn(async (_q: MeetingFeedQuery) => pages.shift() ?? page([]));
  const spec: MeetingFeedSpec<Row> = { ...rows, fetch };
  return { spec, fetch };
}

describe("mergeFeedRows", () => {
  it("appends new rows, skips the overlap and keeps the list when nothing is new", () => {
    const list = [r("a", 1), r("b", 2)];
    expect(ids(mergeFeedRows(list, [r("b", 2), r("c", 3)], rows))).toEqual(["a", "b", "c"]);
    expect(mergeFeedRows(list, [r("a", 1), r("b", 2)], rows)).toBe(list);
  });

  it("places a late row (earlier time) in reading order", () => {
    expect(ids(mergeFeedRows([r("a", 1), r("c", 3)], [r("d", 4), r("b", 2)], rows))).toEqual(["a", "b", "c", "d"]);
  });
});

describe("readMeetingFeed", () => {
  it("reads the newest page when nothing is cached", async () => {
    const qc = new QueryClient();
    const { spec, fetch } = specWith(page([r("a", 1)], { olderCursor: "o1", afterCursor: "t1" }));
    expect(await readMeetingFeed(qc, key, spec)).toEqual({ items: [r("a", 1)], olderCursor: "o1", afterCursor: "t1" });
    expect(fetch).toHaveBeenCalledWith({ signal: undefined });
  });

  it("reads only the delta after the cached cursor and merges it", async () => {
    const qc = new QueryClient();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [r("a", 1), r("b", 2)], olderCursor: "o1", afterCursor: "t2" });
    const { spec, fetch } = specWith(page([r("b", 2), r("c", 3)], { afterCursor: "t3" }));
    const next = await readMeetingFeed(qc, key, spec);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toMatchObject({ after: "t2" });
    expect(next).toEqual({ items: [r("a", 1), r("b", 2), r("c", 3)], olderCursor: "o1", afterCursor: "t3" });
  });

  it("keeps the cursor when the delta is empty", async () => {
    const qc = new QueryClient();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [r("a", 1)], olderCursor: "", afterCursor: "t1" });
    const { spec } = specWith(page([]));
    expect((await readMeetingFeed(qc, key, spec)).afterCursor).toBe("t1");
  });

  it("merges into a row a send wrote while the delta was in flight", async () => {
    const qc = new QueryClient();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [r("a", 1)], olderCursor: "", afterCursor: "t1" });
    const spec: MeetingFeedSpec<Row> = {
      ...rows,
      fetch: async () => {
        addMeetingFeedRow(qc, key, rows, r("mine", 5));
        return page([r("b", 2)], { afterCursor: "t2" });
      },
    };
    expect(ids((await readMeetingFeed(qc, key, spec)).items)).toEqual(["a", "b", "mine"]);
  });

  it("starts over from the newest page when the delta overflowed", async () => {
    const qc = new QueryClient();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [r("a", 1)], olderCursor: "", afterCursor: "t1" });
    const { spec, fetch } = specWith(
      page([r("b", 2)], { hasMoreAfter: true, afterCursor: "t2" }),
      page([r("y", 9), r("z", 10)], { olderCursor: "o9", afterCursor: "t10" }),
    );
    expect(await readMeetingFeed(qc, key, spec)).toEqual({
      items: [r("y", 9), r("z", 10)],
      olderCursor: "o9",
      afterCursor: "t10",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toEqual({ signal: undefined });
  });
});

describe("readOlderMeetingFeed", () => {
  it("prepends the page before the cached one and moves the older cursor", async () => {
    const qc = new QueryClient();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [r("c", 3)], olderCursor: "o3", afterCursor: "t3" });
    const { spec, fetch } = specWith(page([r("a", 1), r("b", 2)], { olderCursor: "" }));
    await readOlderMeetingFeed(qc, key, spec);
    expect(fetch).toHaveBeenCalledWith({ before: "o3" });
    expect(qc.getQueryData(key)).toEqual({ items: [r("a", 1), r("b", 2), r("c", 3)], olderCursor: "", afterCursor: "t3" });
  });

  it("does nothing when no older page exists", async () => {
    const qc = new QueryClient();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [r("a", 1)], olderCursor: "", afterCursor: "t1" });
    const { spec, fetch } = specWith();
    await readOlderMeetingFeed(qc, key, spec);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("addMeetingFeedRow", () => {
  it("adds once and never creates a feed that was not loaded", () => {
    const qc = new QueryClient();
    addMeetingFeedRow(qc, key, rows, r("a", 1));
    expect(qc.getQueryData(key)).toBeUndefined();
    qc.setQueryData<MeetingFeed<Row>>(key, { items: [], olderCursor: "", afterCursor: "" });
    addMeetingFeedRow(qc, key, rows, r("a", 1));
    addMeetingFeedRow(qc, key, rows, r("a", 1));
    expect(ids(qc.getQueryData<MeetingFeed<Row>>(key)!.items)).toEqual(["a"]);
  });
});
