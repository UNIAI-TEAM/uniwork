import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  addNote,
  createJoinRequest,
  createMeeting,
  deleteMeeting,
  getMeeting,
  getMeetingStatistics,
  joinMeeting,
  listInviteLinks,
  listMeetingActivity,
  listMeetings,
  listNotes,
  meetingToken,
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
