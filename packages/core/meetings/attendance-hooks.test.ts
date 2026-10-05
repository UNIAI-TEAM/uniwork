import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../api/session";
import { canClerkMeeting } from "../permissions/rules";
import type { PermissionContext } from "../permissions/types";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import type { MeetingAttendance, MeetingAttendanceRow, MeetingParticipant } from "../types/meeting";
import { useAttendanceFinalized, useMarkAttendance } from "./attendance-hooks";
import { meetingKeys } from "./hooks";

const p = (over: Partial<MeetingParticipant>): MeetingParticipant => ({
  id: "p", meeting_id: "m1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE", ...over,
});
const ctx = (userId: string, wsRole: PermissionContext["wsRole"] = "member"): PermissionContext => ({
  userId,
  orgRole: null,
  wsRole,
});

describe("canClerkMeeting — mirrors MeetingService.requireMeetingClerk", () => {
  const meeting = { host_user_id: "host" };

  it("allows the host and workspace admins", () => {
    expect(canClerkMeeting(meeting, [], ctx("host")).allowed).toBe(true);
    expect(canClerkMeeting(meeting, [], ctx("x", "admin")).allowed).toBe(true);
  });

  it("allows an active signed-in secretary only", () => {
    const sec = p({ user_id: "u1", is_secretary: true });
    expect(canClerkMeeting(meeting, [sec], ctx("u1")).allowed).toBe(true);
    expect(canClerkMeeting(meeting, [{ ...sec, status: "REMOVED" }], ctx("u1")).allowed).toBe(false);
    expect(canClerkMeeting(meeting, [{ ...sec, is_secretary: false }], ctx("u1")).allowed).toBe(false);
    expect(canClerkMeeting(meeting, [sec], ctx("u2")).allowed).toBe(false);
  });

  it("refuses without a workspace role", () => {
    expect(canClerkMeeting(meeting, [p({ user_id: "u1", is_secretary: true })], ctx("u1", null)).allowed).toBe(false);
  });

  it("words the refusal for attendance and votes alike", () => {
    expect(canClerkMeeting(meeting, [], ctx("u2")).message).toBe(
      "Only the host, a secretary or a workspace admin can run attendance and votes.",
    );
  });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const markRow = (over: Partial<MeetingAttendanceRow>): MeetingAttendanceRow => ({
  participant_id: "p1", principal_type: "USER", display_name: "An", standing: "MEMBER", is_secretary: false,
  status: "ABSENT", source: "SUGGESTED", present_seconds: 0, session_count: 0, removed: false,
  joined_after_finalize: false, ...over,
});

const openRoll: MeetingAttendance = {
  quorum_percent: 50,
  summary: { members: 2, present: 1, late: 0, excused: 0, absent: 1, quorum_met: true },
  rows: [markRow({ status: "PRESENT" }), markRow({ participant_id: "p2", display_name: "Bình" })],
};

function clientWithRoll(roll: MeetingAttendance | undefined = openRoll) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (roll) qc.setQueryData(meetingKeys.attendance("m1"), roll);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

describe("useMarkAttendance — optimistic, rolled back on refusal", () => {
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

  it("moves the row and the counts before the server answers", async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementation(
      (url) =>
        String(url).endsWith("/attendance/p2")
          ? new Promise<Response>((resolve) => {
              answer = resolve;
            })
          : Promise.resolve(json(openRoll)),
    );
    const { qc, wrapper } = clientWithRoll();
    const { result } = renderHook(() => useMarkAttendance("m1"), { wrapper });
    act(() => result.current.mutate({ participantId: "p2", status: "LATE" }));
    await waitFor(() =>
      expect(qc.getQueryData<MeetingAttendance>(meetingKeys.attendance("m1"))?.rows[1]).toMatchObject({
        status: "LATE",
        source: "MANUAL",
      }),
    );
    expect(qc.getQueryData<MeetingAttendance>(meetingKeys.attendance("m1"))?.summary).toEqual({
      members: 2, present: 1, late: 1, excused: 0, absent: 0, quorum_met: true,
    });
    // Still waiting on the PUT: the screen did not wait for it.
    expect(result.current.isPending).toBe(true);
    answer(json({ status: "ok" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("puts back the exact roll it replaced when the server refuses", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      json({ error: { code: "attendance_finalized", message: "điểm danh đã chốt; hãy mở lại trước" } }, 409),
    );
    const { qc, wrapper } = clientWithRoll();
    const before = structuredClone(openRoll);
    const seen: (string | undefined)[] = [];
    qc.getQueryCache().subscribe(() =>
      seen.push(qc.getQueryData<MeetingAttendance>(meetingKeys.attendance("m1"))?.rows[1]?.status),
    );
    const { result } = renderHook(() => useMarkAttendance("m1"), { wrapper });
    act(() => result.current.mutate({ participantId: "p2", status: "PRESENT" }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    // It did move optimistically, then came back to the roll as it was, field for field.
    expect(seen).toContain("PRESENT");
    expect(qc.getQueryData(meetingKeys.attendance("m1"))).toStrictEqual(before);
  });
});

describe("useAttendanceFinalized", () => {
  it("reads the lock from the cached roll and stays quiet when disabled", () => {
    const { wrapper } = clientWithRoll({ ...openRoll, finalized_at: "2026-09-30T03:00:00Z" });
    expect(renderHook(() => useAttendanceFinalized("m1", true), { wrapper }).result.current).toBe(true);
    expect(renderHook(() => useAttendanceFinalized("m1", false), { wrapper }).result.current).toBe(false);
  });
});
