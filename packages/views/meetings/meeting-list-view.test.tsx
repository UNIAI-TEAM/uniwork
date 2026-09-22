import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingList } from "./meeting-list";

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

function windowFromNow(startOffsetMs: number, durationMs = 30 * 60_000): { starts_at: string; ends_at: string } {
  const start = Date.now() + startOffsetMs;
  return {
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + durationMs).toISOString(),
  };
}

const meetings: Meeting[] = [
  {
    id: "m1",
    workspace_id: "w1",
    title: "Standup",
    description: "",
    ...windowFromNow(24 * 60 * 60_000),
    room_name: "uw_mtg_m1",
    created_by: "u-host",
    status: "SCHEDULED",
    host_user_id: "u-host",
  },
  {
    id: "m2",
    workspace_id: "w1",
    title: "Retro",
    description: "",
    ...windowFromNow(2 * 60_000, 60 * 60_000),
    room_name: "uw_mtg_m2",
    created_by: "u-host",
    status: "IN_PROGRESS",
    host_user_id: "u-host",
  },
];

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

const members = {
  members: [
    {
      workspace_id: "w1",
      user_id: "u-host",
      role: "owner",
      email: "me@x.com",
      display_name: "Me",
      avatar_url: "https://cdn.test/me.png",
    },
  ],
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
  requestMock.mockImplementation((path: unknown) => {
    if (String(path).endsWith("/members")) return Promise.resolve(members);
    return Promise.resolve({});
  });
});

describe("MeetingList", () => {
  it("renders each meeting once, as one row with its host and the join action", async () => {
    render(shell(<MeetingList workspaceId="w1" meetings={meetings} onOpenRoom={() => {}} />));

    expect(await screen.findAllByText("Me")).toHaveLength(2);
    expect(screen.getAllByText("Standup")).toHaveLength(1);
    expect(screen.getAllByText("Retro")).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: /Retro/ })).toHaveLength(1);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const retroRow = rows.find((row) => within(row).queryByText("Retro"));
    expect(within(retroRow!).getByRole("button", { name: "Vào ngay" })).toBeInTheDocument();
  });

  it("shows the host's photo when the member has one", async () => {
    const { container } = render(shell(<MeetingList workspaceId="w1" meetings={[meetings[0]!]} onOpenRoom={() => {}} />));
    await screen.findByText("Me");
    expect(container.querySelector('img[src="https://cdn.test/me.png"]')).not.toBeNull();
  });

  it("says how soon an upcoming meeting starts and marks an instant one", async () => {
    const soon: Meeting = { ...meetings[0]!, id: "m-soon", title: "Sắp họp", ...windowFromNow(15 * 60_000 + 20_000) };
    const instant: Meeting = { ...meetings[1]!, id: "m-inst", title: "Họp gấp", meeting_type: "INSTANT" };
    render(shell(<MeetingList workspaceId="w1" meetings={[soon, instant]} onOpenRoom={() => {}} />));
    expect(await screen.findByText(/^sau 15 phút/)).toBeInTheDocument();
    expect(screen.getByText("Họp tức thì")).toBeInTheDocument();
  });

  it("hides join and shows overtime when the scheduled window is over", async () => {
    const overtime: Meeting = {
      ...meetings[1]!,
      id: "m-over",
      title: "Overtime standup",
      ...windowFromNow(-10 * 60_000, 5 * 60_000),
      status: "IN_PROGRESS",
    };
    render(shell(<MeetingList workspaceId="w1" meetings={[overtime]} onOpenRoom={() => {}} />));
    expect(await screen.findByText("Overtime standup")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vào ngay" })).not.toBeInTheDocument();
    expect(screen.getByText("Quá giờ")).toBeInTheDocument();
  });

  it("names the day relative to today, with a count", async () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayMeeting: Meeting = {
      ...meetings[0]!,
      starts_at: new Date(`${day}T09:00:00`).toISOString(),
      ends_at: new Date(`${day}T09:30:00`).toISOString(),
    };
    render(shell(<MeetingList workspaceId="w1" meetings={[todayMeeting, meetings[0]!]} onOpenRoom={() => {}} />));
    expect(await screen.findByRole("heading", { name: /Hôm nay/ })).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: /Ngày mai/ })).toBeInTheDocument();
  });

  it("reads the day count in context, not as a bare number", async () => {
    const { container } = render(shell(<MeetingList workspaceId="w1" meetings={[meetings[0]!]} onOpenRoom={() => {}} />));
    expect(await screen.findByRole("heading", { name: /Ngày mai.*\(1 cuộc họp\)/ })).toBeInTheDocument();
    expect(container.querySelector("h2 [aria-hidden]")).toHaveTextContent("1");
  });

  it("paints the rail with the badge's signal, never the meetings tint", () => {
    const { container } = render(shell(<MeetingList workspaceId="w1" meetings={meetings} onOpenRoom={() => {}} />));
    expect(container.querySelector(".bg-tint-violet-solid")).toBeNull();
    expect(container.querySelector(".bg-info")).not.toBeNull();
    expect(container.querySelector(".bg-success")).not.toBeNull();
  });

  it("keeps the full title reachable when it is clamped", () => {
    render(shell(<MeetingList workspaceId="w1" meetings={[meetings[0]!]} onOpenRoom={() => {}} />));
    expect(screen.getByRole("link", { name: /Standup/ })).toHaveAttribute("title", "Standup");
  });

  it("offers rewatch from the list flag and loads recordings only on click", async () => {
    const ended: Meeting = {
      ...meetings[0]!,
      id: "m-ended",
      title: "Cuộc họp tức thì",
      status: "ENDED",
      actual_end_at: new Date().toISOString(),
      has_playable_recording: true,
    };
    const plain: Meeting = { ...ended, id: "m-plain", title: "Không ghi hình", has_playable_recording: false };
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/members")) return Promise.resolve(members);
      if (p.endsWith("/recordings")) {
        return Promise.resolve({
          recordings: [{ id: "rec1", meeting_id: "m-ended", status: "COMPLETE", file_url: "https://x/rec.mp4" }],
        });
      }
      return Promise.resolve({});
    });
    render(shell(<MeetingList workspaceId="w1" meetings={[ended, plain]} onOpenRoom={() => {}} />));
    const buttons = await screen.findAllByRole("button", { name: "Xem lại" });
    expect(buttons).toHaveLength(1);
    const recordingCalls = () => requestMock.mock.calls.filter((c) => String(c[0]).endsWith("/recordings"));
    expect(recordingCalls()).toHaveLength(0);
    fireEvent.click(buttons[0]!);
    await vi.waitFor(() => expect(recordingCalls()).toHaveLength(1));
    expect(String(recordingCalls()[0]![0])).toContain("/meetings/m-ended/recordings");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("MeetingList clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads time-derived states as the clock moves", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T09:00:00"));
    const endingSoon: Meeting = {
      ...meetings[0]!,
      id: "m-tick",
      title: "Sắp hết giờ",
      starts_at: new Date("2026-09-22T08:30:00").toISOString(),
      ends_at: new Date("2026-09-22T09:01:00").toISOString(),
      status: "IN_PROGRESS",
    };
    render(shell(<MeetingList workspaceId="w1" meetings={[endingSoon]} onOpenRoom={() => {}} />));
    expect(screen.getByRole("button", { name: "Vào ngay" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(screen.queryByRole("button", { name: "Vào ngay" })).not.toBeInTheDocument();
    expect(screen.getByText("Quá giờ")).toBeInTheDocument();
  });
});
