import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  clearAttendanceMark,
  finalizeAttendance,
  getMeetingAttendance,
  markAttendance,
  reopenAttendance,
  updateMeetingParticipant,
} from "./meeting-attendance";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const attendance = {
  quorum_percent: 60,
  summary: { members: 2, present: 1, late: 0, excused: 1, absent: 0, quorum_met: false },
  rows: [
    {
      participant_id: "p1", principal_type: "USER", user_id: "u1", display_name: "An",
      standing: "MEMBER", is_secretary: false, status: "PRESENT", source: "SUGGESTED", note: "",
      first_joined_at: "2026-09-30T02:01:00Z", in_room: true, present_seconds: 600, session_count: 1,
    },
  ],
};

describe("meeting attendance endpoints", () => {
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

  it("getMeetingAttendance parses the roll", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(attendance));
    const got = await getMeetingAttendance("m1");
    expect(got.summary.members).toBe(2);
    expect(got.rows[0]?.status).toBe("PRESENT");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/meetings/m1/attendance");
  });

  it("getMeetingAttendance throws on drift instead of showing an empty roll", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ rows: "nope" }));
    await expect(getMeetingAttendance("m1")).rejects.toThrow("meeting_attendance_invalid");
  });

  it("commands hit the right paths and verbs", async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ status: "ok" }));
    await markAttendance("m1", "p1", { status: "EXCUSED", note: "ốm" });
    await clearAttendanceMark("m1", "p1");
    await finalizeAttendance("m1");
    await reopenAttendance("m1");
    const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), init?.method]);
    expect(calls).toEqual([
      ["http://api.test/api/v1/meetings/m1/attendance/p1", "PUT"],
      ["http://api.test/api/v1/meetings/m1/attendance/p1", "DELETE"],
      ["http://api.test/api/v1/meetings/m1/attendance/finalize", "POST"],
      ["http://api.test/api/v1/meetings/m1/attendance/reopen", "POST"],
    ]);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual({ status: "EXCUSED", note: "ốm" });
  });

  it("updateMeetingParticipant returns the participant, or null on drift", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        participant: {
          id: "p1", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE",
          standing: "OBSERVER", is_secretary: false,
        },
      }),
    );
    const p = await updateMeetingParticipant("m1", "p1", { standing: "OBSERVER" });
    expect(p?.standing).toBe("OBSERVER");
    expect(vi.mocked(fetch).mock.calls[0]![1]!.method).toBe("PATCH");
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: true }));
    expect(await updateMeetingParticipant("m1", "p1", { is_secretary: true })).toBeNull();
  });
});
