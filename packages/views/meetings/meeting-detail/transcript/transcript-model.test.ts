import { describe, expect, it } from "vitest";
import { chapterBlocks, chapterIndexAt, citedLines, speakerCounts, transcriptChapters } from "./transcript-model";

const line = (id: string, hhmmss: string) => ({ id, spoken_at: `2026-10-22T${hhmmss}Z` });

describe("transcriptChapters", () => {
  // M1: 09:00 → 09:28 (ICT = 02:00Z), topics at 09:01:14, 09:04:02, 09:09:19.
  const topics = [
    { title: "Rà soát", start_at: "2026-10-22T02:01:14Z" },
    { title: "Tiến độ", start_at: "2026-10-22T02:04:02Z" },
    { title: "Sự kiện", start_at: "2026-10-22T02:09:19Z" },
    { title: "No time", start_at: null },
  ];
  const rows = [line("a", "02:00:12"), line("b", "02:00:40"), line("c", "02:01:20"), line("d", "02:05:00"), line("e", "02:20:00")];

  it("adds the opening before the first topic and sizes each chapter by its minutes", () => {
    const chapters = transcriptChapters({ topics, startIso: "2026-10-22T02:00:00Z", endIso: "2026-10-22T02:28:00Z", rows });
    expect(chapters.map((c) => [c.title, c.minutes, c.count])).toEqual([
      [null, 1, 2],
      ["Rà soát", 3, 1],
      ["Tiến độ", 5, 1],
      ["Sự kiện", 19, 1],
    ]);
    // The 1-minute opening is too narrow for its label; the others have one.
    expect(chapters.map((c) => c.showLabel)).toEqual([false, true, true, true]);
  });

  it("has no opening when the first topic starts with the meeting, and no chapters without timed topics", () => {
    expect(transcriptChapters({ topics: topics.slice(0, 1), startIso: "2026-10-22T02:01:00Z", rows })[0]?.title).toBe("Rà soát");
    expect(transcriptChapters({ topics: [{ title: "x" }], startIso: "2026-10-22T02:00:00Z", rows })).toEqual([]);
  });

  it("counts lines before the start in the first chapter and after the end in the last", () => {
    const chapters = transcriptChapters({
      topics: topics.slice(0, 1),
      startIso: "2026-10-22T02:01:14Z",
      endIso: "2026-10-22T02:10:00Z",
      rows: [line("early", "01:59:00"), line("late", "02:30:00")],
    });
    expect(chapters.map((c) => c.count)).toEqual([2]);
    expect(chapterIndexAt(chapters, "2026-10-22T01:00:00Z")).toBe(0);
    // Not loaded (or failed): the chapters keep their times, with no count.
    expect(transcriptChapters({ topics, startIso: "2026-10-22T02:00:00Z", rows: undefined }).map((c) => c.count)).toEqual([null, null, null, null]);
  });
});

describe("speakerCounts", () => {
  it("counts lines per speaker, most first, ties in order of appearance", () => {
    const rows = [
      { n: "Hà Vũ", participant_id: "p2" },
      { n: "Lan Phạm", participant_id: "p1" },
      { n: "Lan Phạm", participant_id: "p1" },
      { n: "Minh Trần", participant_id: "p3" },
      { n: "Hà Vũ", participant_id: "p2" },
      { n: "Minh Trần", participant_id: "p3" },
    ];
    expect(speakerCounts(rows, (r) => r.n)).toEqual([
      { name: "Hà Vũ", count: 2, participantId: "p2" },
      { name: "Lan Phạm", count: 2, participantId: "p1" },
      { name: "Minh Trần", count: 2, participantId: "p3" },
    ]);
  });
});

describe("citedLines", () => {
  const seg = (id: string) => ({ kind: "segment", id });
  it("cites the line each decision, question and live item opens on, never a later ref or a dismissed item", () => {
    const cited = citedLines({
      decisions: [{ evidence: [seg("s1")] }, { evidence: [{ kind: "note", id: "n1" }, seg("s9")] }],
      questions: [{ evidence: [seg("s2"), seg("s1")] }],
      items: [
        { title: "Gửi báo giá", status: "PENDING", evidence: [seg("s1"), seg("s3")] },
        { title: "Bỏ", status: "DISMISSED", evidence: [seg("s4")] },
        { title: "Duyệt kịch bản", status: "CONVERTED", evidence: [seg("s5")] },
      ],
    });
    expect(Object.fromEntries(cited)).toEqual({
      s1: [
        { kind: "decision", n: 1 },
        { kind: "item", n: 1, title: "Gửi báo giá" },
      ],
      s2: [{ kind: "question", n: 1 }],
      s5: [{ kind: "item", n: 2, title: "Duyệt kịch bản" }],
    });
  });
});

describe("chapterBlocks", () => {
  const rows = Array.from({ length: 30 }, (_, i) => `r${i}`);
  const base = { rows, from: 10, expanded: new Set<string>(), chapterKey: "c" };

  it("draws every line without a search", () => {
    const blocks = chapterBlocks({ ...base, hits: new Set(), active: -1, searching: false })!;
    expect(blocks).toHaveLength(30);
    expect(blocks[0]).toEqual({ kind: "line", row: "r0", index: 10 });
  });

  it("draws 6 lines before and 5 after the active hit and folds the rest with their hits", () => {
    const blocks = chapterBlocks({ ...base, hits: new Set([12, 23, 35]), active: 23, searching: true })!;
    expect(blocks[0]).toMatchObject({ kind: "fold", side: "before", hits: 1 });
    expect(blocks[0]!.kind === "fold" && blocks[0]!.rows).toHaveLength(7);
    const lines = blocks.filter((b) => b.kind === "line").map((b) => (b.kind === "line" ? b.index : -1));
    expect(lines).toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(blocks[blocks.length - 1]).toMatchObject({ kind: "fold", side: "after", hits: 1 });
  });

  it("folds a chapter whose hits are not active, skips one without hits, and draws an expanded fold", () => {
    expect(chapterBlocks({ ...base, hits: new Set([15]), active: 99, searching: true })).toEqual([
      { kind: "fold", key: "c:all", side: "all", rows, hits: 1 },
    ]);
    expect(chapterBlocks({ ...base, hits: new Set([99]), active: 99, searching: true })).toBeNull();
    const open = chapterBlocks({ ...base, expanded: new Set(["c:before"]), hits: new Set([23]), active: 23, searching: true })!;
    expect(open[0]).toEqual({ kind: "line", row: "r0", index: 10 });
  });
});
