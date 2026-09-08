import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  addNote,
  appendMeetingChat,
  appendTranscript,
  createJoinRequest,
  createMeeting,
  createMeetingSummary,
  createTasksFromSummary,
  deleteMeeting,
  fetchMeetingCalendar,
  getMeeting,
  getMeetingCapabilities,
  getMeetingStatistics,
  getMeetingSummary,
  joinMeeting,
  listInviteLinks,
  listMeetingActivity,
  listMeetingChat,
  listMeetings,
  listNotes,
  listRecordings,
  listTranscript,
  meetingToken,
  setParticipantPublish,
  startRecording,
  stopRecording,
  updateMeeting,
} from "./meetings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const meeting = {
  id: "m1", workspace_id: "ws1", title: "Sync", description: "",
  starts_at: "2026-08-25T09:00:00Z", ends_at: "2026-08-25T10:00:00Z",
  room_name: "room-m1", created_by: "u1",
};

describe("meetings endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("listMeetings returns meetings and [] on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ meetings: [meeting], total: 1 }));
    expect((await listMeetings("ws1")).meetings).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ meetings: [{ id: "m1" }] }));
    await expect(listMeetings("ws1")).resolves.toEqual({ meetings: [], total: 0 });
  });

  it("listMeetings sends filters on the query string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ meetings: [], total: 0 }));
    await listMeetings("ws1", { status: "SCHEDULED", q: "sync", limit: 20, offset: 0 });
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("status=SCHEDULED");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("q=sync");
  });

  it("getMeeting / createMeeting return the meeting or null", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ meeting }))
      .mockResolvedValueOnce(json({ meeting: 42 }))
      .mockResolvedValueOnce(json({ meeting }));
    expect((await getMeeting("m1"))?.room_name).toBe("room-m1");
    await expect(getMeeting("m1")).resolves.toBeNull();
    const created = await createMeeting("ws1", {
      title: "Sync", starts_at: meeting.starts_at, ends_at: meeting.ends_at,
    });
    expect(created?.id).toBe("m1");
  });

  it("deleteMeeting and addNote resolve without a body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" })).mockResolvedValueOnce(json({ status: "ok" }));
    await expect(deleteMeeting("m1")).resolves.toBeUndefined();
    await expect(addNote("m1", "ghi chú")).resolves.toBeUndefined();
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string)).toEqual({ body: "ghi chú" });
  });

  it("listNotes returns [] on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ notes: [{ id: "n1", meeting_id: "m1", author_id: "u1", body: "x" }] }));
    expect(await listNotes("m1")).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ notes: null }));
    await expect(listNotes("m1")).resolves.toEqual([]);
  });

  it("meetingToken returns null on drift so the room shows its error state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ token: "t", url: "wss://lk" }));
    expect((await meetingToken("m1"))?.url).toBe("wss://lk");
    vi.mocked(fetch).mockResolvedValueOnce(json({ token: "t" }));
    await expect(meetingToken("m1")).resolves.toBeNull();
  });

  it("joinMeeting returns a decision or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      decision: "ADMIT", participant_token: "t", server_url: "wss://lk",
    }));
    expect((await joinMeeting("m1"))?.decision).toBe("ADMIT");
    vi.mocked(fetch).mockResolvedValueOnce(json({ token: "t" }));
    await expect(joinMeeting("m1")).resolves.toBeNull();
  });

  it("updateMeeting / statistics / activity / invite-links / join-request degrade on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ meeting }))
      .mockResolvedValueOnce(json({ meeting: 1 }))
      .mockResolvedValueOnce(json({ total: 3, scheduled: 1, in_progress: 1, ended: 1, canceled: 0 }))
      .mockResolvedValueOnce(json({ total: "nope" }))
      .mockResolvedValueOnce(json({ activity: [{ id: "a1", event_type: "MEETING_CREATED", actor_id: "u1", occurred_at: meeting.starts_at }] }))
      .mockResolvedValueOnce(json({ activity: null }))
      .mockResolvedValueOnce(json({ invite_links: [{ id: "l1", meeting_id: "m1", name: "n", access_mode: "AUTO_ADMIT", expires_at: meeting.ends_at, used_count: 0 }] }))
      .mockResolvedValueOnce(json({ invite_links: [{ id: 1 }] }))
      .mockResolvedValueOnce(json({ join_request: { id: "r1", meeting_id: "m1", status: "PENDING" } }))
      .mockResolvedValueOnce(json({ join_request: 1 }));
    expect((await updateMeeting("m1", { title: "Sync" }))?.id).toBe("m1");
    await expect(updateMeeting("m1", { title: "x" })).resolves.toBeNull();
    expect((await getMeetingStatistics("ws1"))?.total).toBe(3);
    await expect(getMeetingStatistics("ws1")).resolves.toBeNull();
    expect(await listMeetingActivity("m1")).toHaveLength(1);
    await expect(listMeetingActivity("m1")).resolves.toEqual([]);
    expect(await listInviteLinks("m1")).toHaveLength(1);
    await expect(listInviteLinks("m1")).resolves.toEqual([]);
    expect((await createJoinRequest("m1"))?.id).toBe("r1");
    await expect(createJoinRequest("m1")).resolves.toBeNull();
  });
});

describe("meetings D08b endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("capabilities degrade to {} on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ai_summary: true, recording: false, server_stt: true }));
    expect(await getMeetingCapabilities("ws1")).toEqual({ ai_summary: true, recording: false, server_stt: true });
    vi.mocked(fetch).mockResolvedValueOnce(json({ ai_summary: "yes" }));
    expect(await getMeetingCapabilities("ws1")).toEqual({});
  });

  it("setParticipantPublish posts enabled flag", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    await setParticipantPublish("m1", "p1", false);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("/participants/p1/publish");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
  });

  it("transcript list/append", async () => {
    const seg = { id: "s1", meeting_id: "m1", text: "hi", spoken_at: "2026-08-29T02:00:00Z" };
    vi.mocked(fetch).mockResolvedValueOnce(json({ segments: [seg] }));
    expect(await listTranscript("m1")).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ segments: [{ id: 1 }] }));
    expect(await listTranscript("m1")).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ segment: seg }));
    await appendTranscript("m1", "hi", "2026-08-29T02:00:00Z");
    const init = vi.mocked(fetch).mock.calls[2]![1] as RequestInit;
    expect(String(vi.mocked(fetch).mock.calls[2]![0])).toBe("http://api.test/api/v1/meetings/m1/transcript");
    expect(JSON.parse(String(init.body))).toEqual({ text: "hi", spoken_at: "2026-08-29T02:00:00Z" });
  });

  it("chat list/append", async () => {
    const msg = {
      id: "c1",
      meeting_id: "m1",
      sender_identity: "uw_participant_p1",
      sender_name: "An",
      message: "hi",
      sent_at: "2026-08-29T02:00:00Z",
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [msg] }));
    expect(await listMeetingChat("m1")).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ messages: [{ id: 1 }] }));
    expect(await listMeetingChat("m1")).toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ message: msg }));
    expect((await appendMeetingChat("m1", "hi\nthere"))?.message).toBe("hi");
    const init = vi.mocked(fetch).mock.calls[2]![1] as RequestInit;
    expect(String(vi.mocked(fetch).mock.calls[2]![0])).toBe("http://api.test/api/v1/meetings/m1/chat");
    expect(JSON.parse(String(init.body))).toEqual({ message: "hi\nthere" });
  });

  it("summary get/create return null on drift; tasks return ids", async () => {
    const summary = { id: "x", meeting_id: "m1", summary: "S", decisions: ["D"], action_items: [{ title: "T" }] };
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary }));
    expect((await getMeetingSummary("m1"))?.decisions).toEqual(["D"]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: null }));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "not_found", message: "not found" } }, 404));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: { id: "x" } }));
    expect(await getMeetingSummary("m1")).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ summary }));
    expect((await createMeetingSummary("m1", "vi"))?.summary).toBe("S");
    vi.mocked(fetch).mockResolvedValueOnce(json({ task_ids: ["t1", "t2"] }));
    expect(await createTasksFromSummary("m1", [{ title: "a" }, { title: "b" }])).toEqual(["t1", "t2"]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ task_ids: "nope" }));
    expect(await createTasksFromSummary("m1", [{ title: "a" }])).toEqual([]);
  });

  it("recordings start/stop/list", async () => {
    const rec = { id: "r1", meeting_id: "m1", status: "ACTIVE" };
    vi.mocked(fetch).mockResolvedValueOnce(json({ recording: rec }));
    expect((await startRecording("m1"))?.status).toBe("ACTIVE");
    vi.mocked(fetch).mockResolvedValueOnce(json({ recording: { ...rec, status: "PROCESSING" } }));
    expect((await stopRecording("m1"))?.status).toBe("PROCESSING");
    vi.mocked(fetch).mockResolvedValueOnce(json({ recordings: [rec] }));
    expect(await listRecordings("m1")).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ recordings: null }));
    expect(await listRecordings("m1")).toEqual([]);
  });

  it("calendar returns the raw text with the bearer token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("BEGIN:VCALENDAR\r\n", { status: 200 }));
    expect(await fetchMeetingCalendar("m1")).toContain("BEGIN:VCALENDAR");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});
