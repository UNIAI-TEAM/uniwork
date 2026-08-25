import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { addNote, createMeeting, deleteMeeting, getMeeting, listMeetings, listNotes, meetingToken } from "./meetings";

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
    vi.mocked(fetch).mockResolvedValueOnce(json({ meetings: [meeting] }));
    expect(await listMeetings("ws1")).toHaveLength(1);
    vi.mocked(fetch).mockResolvedValueOnce(json({ meetings: [{ id: "m1" }] }));
    await expect(listMeetings("ws1")).resolves.toEqual([]);
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
});
