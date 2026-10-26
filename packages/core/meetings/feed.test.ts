import { describe, expect, it } from "vitest";
import type { MeetingActionItem } from "../api/endpoints/meeting-action-items";
import type { MeetingNote, MeetingRecording, MeetingSummary, MeetingTranscriptSegment } from "../types/meeting";
import { buildMeetingFeed, countFeed, transcriptLinks } from "./feed";

const item = (over: Partial<MeetingActionItem> & { id: string }): MeetingActionItem => ({
  title: `Việc ${over.id}`,
  status: "PENDING",
  evidence: [],
  ...over,
});
const segment = (id: string, spoken_at: string): MeetingTranscriptSegment => ({ id, meeting_id: "m1", text: id, spoken_at });
const note = (id: string, created_at: string | null): MeetingNote => ({
  id,
  meeting_id: "m1",
  author_id: "u1",
  body: `Ghi chú ${id}`,
  created_at,
});
const recording = (over: Partial<MeetingRecording> & { id: string; status: string }): MeetingRecording => ({
  meeting_id: "m1",
  ...over,
});
const summary = (over: Partial<MeetingSummary>): MeetingSummary => ({
  id: "sum1",
  meeting_id: "m1",
  summary: "",
  created_at: "2026-10-26T10:30:00Z",
  ...over,
});

const empty = { actionItems: [], summary: null, notes: [], transcript: [], recordings: [] };

describe("buildMeetingFeed", () => {
  const input = {
    actionItems: [
      item({
        id: "a1",
        status: "PENDING",
        created_at: "2026-10-26T10:12:00Z",
        evidence: [
          { kind: "note", id: "n9" },
          { kind: "segment", id: "s2" },
          { kind: "segment", id: "s1" },
        ],
      }),
      item({ id: "a2", status: "CONVERTED", source: "LIVE", created_at: "2026-10-26T10:20:00Z" }),
      item({ id: "a3", status: "DISMISSED", created_at: "2026-10-26T10:25:00Z" }),
      item({ id: "a4", status: "ARCHIVED", created_at: "2026-10-26T10:26:00Z" }),
    ],
    summary: summary({
      decisions: [{ text: "Chốt ngân sách", evidence: [] }],
      open_questions: [{ text: "Ai lo hậu cần?", evidence: [{ kind: "segment", id: "s1" }] }],
    }),
    notes: [note("n1", "2026-10-26T10:15:00Z")],
    transcript: [segment("s1", "2026-10-26T10:05:00Z"), segment("s2", "2026-10-26T10:10:00Z")],
    recordings: [
      recording({ id: "r1", status: "COMPLETE", started_at: "2026-10-26T10:00:00Z", ended_at: "2026-10-26T10:40:00Z" }),
      recording({ id: "r2", status: "ACTIVE", started_at: "2026-10-26T10:41:00Z" }),
    ],
  };

  it("merges the five kinds newest first, dropping dismissed and unknown items and unfinished recordings", () => {
    const feed = buildMeetingFeed(input);
    expect(feed.map((e) => e.id)).toEqual([
      "recording:r1",
      "decision:0",
      "task:a2",
      "note:n1",
      "task:a1",
      "question:0",
    ]);
    expect(countFeed(feed)).toEqual({ all: 6, decision: 1, task: 2, question: 1, note: 1, recording: 1 });
  });

  it("dates and anchors each entry by its own rule", () => {
    const byId = new Map(buildMeetingFeed(input).map((e) => [e.id, e]));
    // Task: created_at, and the first segment evidence (not the first evidence).
    expect(byId.get("task:a1")).toMatchObject({ kind: "task", text: "Việc a1", at: "2026-10-26T10:12:00Z", segmentId: "s2" });
    expect(byId.get("task:a1")?.actionItem?.id).toBe("a1");
    expect(byId.get("task:a2")).toMatchObject({ at: "2026-10-26T10:20:00Z", segmentId: null });
    // Decision without evidence: the summary's time.
    expect(byId.get("decision:0")).toMatchObject({ kind: "decision", text: "Chốt ngân sách", at: "2026-10-26T10:30:00Z", segmentId: null });
    // Question: when its first segment was said.
    expect(byId.get("question:0")).toMatchObject({ kind: "question", text: "Ai lo hậu cần?", at: "2026-10-26T10:05:00Z", segmentId: "s1" });
    expect(byId.get("note:n1")).toMatchObject({ kind: "note", text: "Ghi chú n1", at: "2026-10-26T10:15:00Z", segmentId: null });
    expect(byId.get("note:n1")?.note?.id).toBe("n1");
    // Recording: ended_at first.
    expect(byId.get("recording:r1")).toMatchObject({ kind: "recording", at: "2026-10-26T10:40:00Z", segmentId: null });
    expect(byId.get("recording:r1")?.recording?.id).toBe("r1");
  });

  it("dates a decision by the summary when its segment is not loaded, and a recording by started_at when it has no end", () => {
    const feed = buildMeetingFeed({
      ...empty,
      summary: summary({ decisions: [{ text: "D", evidence: [{ kind: "segment", id: "gone" }] }] }),
      recordings: [recording({ id: "r1", status: "COMPLETE", started_at: "2026-10-26T09:00:00Z" })],
    });
    expect(feed.map((e) => [e.id, e.at, e.segmentId])).toEqual([
      ["decision:0", "2026-10-26T10:30:00Z", "gone"],
      ["recording:r1", "2026-10-26T09:00:00Z", null],
    ]);
  });

  it("compares instants, breaks ties by kind then input order, and puts undated entries last", () => {
    const at = "2026-10-26T10:00:00Z";
    const sameInstant = "2026-10-26T17:00:00+07:00";
    const feed = buildMeetingFeed({
      actionItems: [item({ id: "t1", created_at: sameInstant }), item({ id: "t2", created_at: at }), item({ id: "t0" })],
      summary: summary({
        created_at: null,
        decisions: [{ text: "D0", evidence: [] }],
        open_questions: [{ text: "Q0", evidence: [{ kind: "segment", id: "s1" }] }],
      }),
      notes: [note("n1", at), note("n0", null)],
      transcript: [segment("s1", sameInstant)],
      recordings: [recording({ id: "r1", status: "COMPLETE", ended_at: at })],
    });
    expect(feed.map((e) => e.id)).toEqual([
      "task:t1",
      "task:t2",
      "question:0",
      "note:n1",
      "recording:r1",
      "decision:0",
      "task:t0",
      "note:n0",
    ]);
  });

  it("is empty with nothing to show", () => {
    expect(buildMeetingFeed(empty)).toEqual([]);
    expect(countFeed([])).toEqual({ all: 0, decision: 0, task: 0, question: 0, note: 0, recording: 0 });
  });
});

describe("transcriptLinks", () => {
  it("links each line to the decisions and the tasks the feed shows resting on it", () => {
    const links = transcriptLinks({
      actionItems: [
        item({ id: "a1", owner_text: "Minh", evidence: [{ kind: "segment", id: "s2" }] }),
        item({ id: "a2", status: "DISMISSED", owner_text: "Lan", evidence: [{ kind: "segment", id: "s1" }] }),
        // A status the feed does not show gets no chip either, so a chip never points at a missing entry.
        item({ id: "a3", status: "ARCHIVED", owner_text: "Hà", evidence: [{ kind: "segment", id: "s4" }] }),
      ],
      summary: summary({
        decisions: [{ text: "D", evidence: [{ kind: "segment", id: "s1" }, { kind: "note", id: "n1" }] }],
        open_questions: [{ text: "Q", evidence: [{ kind: "segment", id: "s3" }] }],
      }),
    });
    expect(links).toEqual(
      new Map([
        ["s1", [{ kind: "decision" }]],
        ["s2", [{ kind: "task", owner: "Minh" }]],
      ]),
    );
  });

  it("keeps several links on one line without repeating one, from every source", () => {
    const links = transcriptLinks({
      actionItems: [
        item({ id: "a1", source: "LIVE", owner_text: "", evidence: [{ kind: "segment", id: "s1" }] }),
        item({ id: "a2", source: "AI", status: "CONVERTED", evidence: [{ kind: "segment", id: "s1" }] }),
        item({ id: "a3", source: "MANUAL", owner_text: "Minh", evidence: [{ kind: "segment", id: "s1" }] }),
      ],
      summary: summary({
        decisions: [
          { text: "D0", evidence: [{ kind: "segment", id: "s1" }, { kind: "segment", id: "s1" }] },
          { text: "D1", evidence: [{ kind: "segment", id: "s1" }] },
        ],
      }),
    });
    expect(links.get("s1")).toEqual([{ kind: "decision" }, { kind: "task", owner: null }, { kind: "task", owner: "Minh" }]);
    expect(transcriptLinks({ actionItems: [], summary: undefined }).size).toBe(0);
  });
});
