// Test fixtures shared by the meeting-detail suites (not exported to the app).
// Data: the demo capture (`.superpowers/meeting-detail-redesign/capture/data.json`,
// trimmed and email-free in test-fixtures.json). Boards are drawn at DEMO_NOW.
import { ApiError } from "@uniwork/core/api/http";
import type { Meeting, MeetingParticipant, User, Workspace } from "@uniwork/core/types";
import type { MeetingInvitation } from "@uniwork/core/types/meeting";
import { displayMeetingStatus } from "@uniwork/core/meetings";
import { requestMock } from "../../test/request-mock";
import data from "./test-fixtures.json";
import type { DetailContextValue } from "./detail-context";
import { sectionFlags, viewerRole, visibleTabs } from "./detail-model";

/** Fri 23/10/2026 21:18 ICT, the clock of every detail board (Overtime: +1 h). */
export const DEMO_NOW = Date.parse("2026-10-23T14:18:00Z");

export type DemoUserKey = keyof typeof data.users;
/** m1 ended · m3 scheduled with a guest link · m4 live (open motion 2/4, a guest waiting) · m5 canceled · m6 missed · m1Outsider = m1 read by Tuấn. */
export type MeetingFixtureKey = "m1" | "m3" | "m4" | "m5" | "m6" | "m1Outsider";

export const demo = data;

export const demoWorkspace: Workspace = {
  id: data.workspace.id,
  slug: data.workspace.slug,
  name: data.workspace.name,
  organization_id: data.org.id,
  organization_slug: data.org.slug,
  organization_name: data.org.name,
};

export function demoUser(key: DemoUserKey): User {
  const u = data.users[key];
  return {
    id: u.id,
    email: `${key}@saomai.test`,
    display_name: u.name,
    onboarded_at: "2026-10-01T00:00:00Z",
    email_verified_at: "2026-10-01T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  };
}

type Bundle = (typeof data.meetings)["m1"];

function bundleOf(key: MeetingFixtureKey): Bundle {
  return (key === "m1Outsider" ? data.meetings.m1 : data.meetings[key]) as Bundle;
}

/** The meeting as its GET answers (the outsider copy has `ai_content_readable: false`). */
export function fixtureMeeting(key: MeetingFixtureKey): Meeting {
  return (key === "m1Outsider" ? data.m1_as_outsider.meeting : bundleOf(key).meeting) as Meeting;
}

/** The answer of each GET under /api/v1/meetings/{id}, by its last path segment. */
function answers(key: MeetingFixtureKey): Record<string, unknown> {
  const b = bundleOf(key);
  const outsider = key === "m1Outsider";
  return {
    participants: { participants: b.participants },
    invitations: { invitations: b.invitations },
    attendance: b.attendance,
    summary: b.summary,
    "action-items": outsider ? data.m1_as_outsider.action_items : b.action_items,
    notes: { notes: b.notes },
    motions: b.motions,
    minutes: b.minutes,
    activity: b.activity,
    "carried-over-items": b.carried_over,
    "invite-links": b.invite_links,
    "join-requests": b.join_requests,
    recordings: b.recordings,
    "dial-in": b.dial_in,
    transcript: b.transcript,
  };
}

/**
 * Installs `requestMock` answers for every meeting GET of the fixture, the
 * workspace members (join order lan → ha → minh → tuan → bao) and the
 * viewer's membership. The outsider's summary is the server's 403
 * `meeting_ai_restricted`. Anything else answers `{}`, as the older suites do.
 * `extra` routes run first (path → answer), for a suite's own cases.
 */
export function routeMeeting(
  key: MeetingFixtureKey,
  { viewer = key === "m1Outsider" ? "tuan" : "lan", extra = {} }: { viewer?: DemoUserKey; extra?: Record<string, unknown> } = {},
): void {
  const meeting = fixtureMeeting(key);
  const base = `/api/v1/meetings/${meeting.id}`;
  const byPath = answers(key);
  const role = data.members.find((m) => m.user_id === data.users[viewer].id)?.role ?? "member";
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    const pathname = p.split("?")[0]!;
    if (pathname in extra) return Promise.resolve(extra[pathname]);
    if (pathname.endsWith("/me")) {
      return Promise.resolve({ membership: { user_id: data.users[viewer].id, role, source: "membership" } });
    }
    if (pathname.endsWith("/members")) return Promise.resolve({ members: data.members });
    if (pathname === base) return Promise.resolve({ meeting });
    if (key === "m1Outsider" && pathname === `${base}/summary`) {
      return Promise.reject(new ApiError("nội dung AI của cuộc họp chỉ dành cho người tham dự", "meeting_ai_restricted", 403));
    }
    if (pathname.startsWith(`${base}/`)) {
      const segment = pathname.slice(base.length + 1);
      if (segment in byPath) return Promise.resolve(byPath[segment]);
    }
    return Promise.resolve({});
  });
}

/**
 * A `DetailContext` value for a slot test, built with the same rules as the
 * page, seen by `user`. Override any field (`layout`, `tabs`…) per case.
 */
export function detailValue(
  key: MeetingFixtureKey,
  {
    user = key === "m1Outsider" ? "tuan" : "lan",
    now = DEMO_NOW,
    ...overrides
  }: { user?: DemoUserKey } & Partial<DetailContextValue> = {},
): DetailContextValue {
  const meeting = fixtureMeeting(key);
  const b = bundleOf(key);
  const participants = (b.participants as MeetingParticipant[]).filter((p) => p.status === "ACTIVE");
  const userId = data.users[user].id;
  const member = data.members.find((m) => m.user_id === userId);
  const canHost = userId === meeting.host_user_id || member?.role === "owner" || member?.role === "admin";
  const viewer = viewerRole({ userId, hostUserId: meeting.host_user_id, participants, canHost });
  const displayStatus = displayMeetingStatus(meeting, now);
  const aiReadable = meeting.ai_content_readable !== false;
  const list = visibleTabs(displayStatus, viewer, { aiReadable, minutes: true });
  const byId = new Map(data.members.map((m) => [m.user_id, m]));
  return {
    workspaceId: data.workspace.id,
    meeting,
    displayStatus,
    now,
    viewer,
    canHost,
    isClerk: viewer === "host" || viewer === "secretary" || viewer === "admin",
    aiReadable,
    layout: "page",
    isPhone: false,
    memberIndex: {
      memberOf: (id?: string | null) => (id ? byId.get(id) : undefined),
      members: data.members,
      loaded: true,
    } as DetailContextValue["memberIndex"],
    participants,
    invitations: b.invitations as MeetingInvitation[],
    rosterLoaded: true,
    sections: sectionFlags({
      status: displayStatus,
      viewer,
      aiReadable,
      minutesOn: true,
      hasProject: Boolean(meeting.project_id),
    }),
    tabs: { list, current: list[0] ?? null, set: () => {} },
    roll: { open: false, setOpen: () => {} },
    ...overrides,
  };
}
