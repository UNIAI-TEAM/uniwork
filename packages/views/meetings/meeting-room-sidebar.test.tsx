import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomSidebar, MeetingSidebarDock } from "./meeting-room-sidebar";

vi.mock("@livekit/components-react", () => ({
  useLocalParticipant: () => ({ localParticipant: { identity: "u-me" } }),
  useChat: () => ({ chatMessages: [], send: vi.fn(), isSending: false }),
  useParticipants: () => [],
}));

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const meeting = {
  id: "m1", workspace_id: "w1", title: "Giao ban", description: "", starts_at: "2026-10-01T02:00:00Z",
  ends_at: "2026-10-01T03:00:00Z", room_name: "r", created_by: "u-host", status: "IN_PROGRESS", host_user_id: "u-host",
} as Meeting;
const openMotion = {
  id: "mo1", title: "Thông qua kế hoạch quý IV", description: "", position: 1,
  ballot_mode: "SECRET", threshold: "MAJORITY", base: "PRESENT", status: "OPEN",
  opened_at: "2026-10-01T02:10:00Z", roll_size: 3, total_members: 4, cast_count: 0,
  result: null, voters: null, my_ballot: { on_roll: true, cast: false, choice: null },
};
const PENDING = "Có nội dung đang chờ bạn bỏ phiếu";
let motions: unknown[] = [];

/** Each tab's label, without the badge meaning its name carries after ", ". */
function tabLabels(): (string | undefined)[] {
  return screen.getAllByRole("tab").map((el) => el.getAttribute("aria-label")?.split(", ")[0]);
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  motions = [];
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/recordings")) return Promise.resolve({ recordings: [] });
    if (p.endsWith("/motions")) return Promise.resolve({ motions });
    if (p.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u-host", role: "owner", source: "membership" } });
    if (p.endsWith("/members")) return Promise.resolve({ members: [] });
    if (p.endsWith("/participants")) {
      return Promise.resolve({
        participants: [
          { id: "p-host", meeting_id: "m1", principal_type: "USER", user_id: "u-host", role: "MODERATOR", status: "ACTIVE", standing: "MEMBER" },
        ],
      });
    }
    return Promise.resolve({});
  });
});

describe("MeetingSidebarDock", () => {
  it("takes a closed panel out of the tab order and hands focus to the active tab on open", () => {
    const { rerender } = render(
      <MeetingSidebarDock open={false}>
        <button type="button" role="tab" aria-selected="true">
          Chat
        </button>
      </MeetingSidebarDock>,
    );
    const tab = screen.getByRole("tab", { hidden: true });
    const dock = tab.closest("[data-testid='meeting-sidebar-dock']")!;
    expect(dock).toHaveAttribute("inert");

    rerender(
      <MeetingSidebarDock open>
        <button type="button" role="tab" aria-selected="true">
          Chat
        </button>
      </MeetingSidebarDock>,
    );
    expect(dock).not.toHaveAttribute("inert");
    expect(tab).toHaveFocus();
  });

  it("does not steal focus when the panel is already open on first render", () => {
    render(
      <MeetingSidebarDock open>
        <button type="button" role="tab" aria-selected="true">
          Chat
        </button>
      </MeetingSidebarDock>,
    );
    expect(screen.getByRole("tab")).not.toHaveFocus();
  });
});

describe("MeetingRoomSidebar", () => {
  it("wires each tab to the panel it controls", () => {
    render(
      wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode />),
    );
    const tab = screen.getByRole("tab", { name: "Trò chuyện" });
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAccessibleName("Trò chuyện");
    // Only the active panel exists; the others must not point at nothing.
    expect(screen.getByRole("tab", { name: "Mọi người" })).not.toHaveAttribute("aria-controls");
  });

  it("counts chat messages that arrived while the chat was off screen", () => {
    render(
      wrapWithNav(
        <MeetingRoomSidebar meetingId="m1" tab="participants" onTabChange={() => {}} guestMode chatUnread={3} />,
      ),
    );
    // The count is part of the tab's own name, not a label on a bare span.
    expect(screen.getByRole("tab", { name: /^Trò chuyện\W+3 tin nhắn chưa đọc$/ })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toHaveAccessibleName("Bảng phụ cuộc họp");
  });

  it("badges the UNI tab with the live items the scribe wrote while it was off screen (UNI-1995 #21)", () => {
    render(
      wrapWithNav(
        <MeetingRoomSidebar meetingId="m1" meeting={meeting} workspaceId="w1" tab="chat" onTabChange={() => {}} liveItemsUnseen={2} />,
      ),
    );
    expect(screen.getByRole("tab", { name: /^UNI\W+2 việc UNI mới ghi$/ })).toBeInTheDocument();
  });

  it("has no recordings tab any more", () => {
    render(wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode />));
    expect(screen.queryByRole("tab", { name: /^Bản ghi/ })).not.toBeInTheDocument();
  });

  it("offers a collapse button beside the tabs when the panel can collapse", () => {
    const onCollapse = vi.fn();
    const { rerender } = render(
      wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode />),
    );
    expect(screen.queryByRole("button", { name: "Thu gọn bảng" })).not.toBeInTheDocument();
    rerender(
      wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode onCollapse={onCollapse} />),
    );
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn bảng" }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("hides the votes tab from a guest while nothing has been opened", async () => {
    render(wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode />));
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([p]) => String(p).endsWith("/meetings/m1/motions"))).toBe(true),
    );
    // React Query hands results to the view on a zero-delay timer: let it land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByRole("tab", { name: /^Biểu quyết/ })).not.toBeInTheDocument();
    expect(tabLabels()).toEqual(["Trò chuyện", "Mọi người"]);
  });

  it("shows the votes tab once an item is open, with a badge while my vote is due", async () => {
    motions = [openMotion];
    render(wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode />));
    const tab = await screen.findByRole("tab", { name: /^Biểu quyết/ });
    expect(tab).toHaveAccessibleName(new RegExp(PENDING));
    expect(tabLabels()).toEqual(["Trò chuyện", "Mọi người", "Biểu quyết"]);
  });

  it("drops the badge once the vote is cast", async () => {
    motions = [
      {
        ...openMotion,
        status: "CLOSED",
        closed_at: "2026-10-01T02:20:00Z",
        cast_count: 3,
        result: { yes: 2, no: 1, abstain: 0, required: 2, outcome: "PASSED" },
        my_ballot: { on_roll: true, cast: true, choice: null },
      },
    ];
    render(wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={() => {}} guestMode />));
    await screen.findByRole("tab", { name: "Biểu quyết" });
    expect(screen.getByRole("tab", { name: "Biểu quyết" })).not.toHaveAccessibleName(new RegExp(PENDING));
  });

  it("always shows the votes tab to a clerk, after people", async () => {
    setSessionUser(me);
    const onTabChange = vi.fn();
    render(
      wrapWithNav(
        <MeetingRoomSidebar meetingId="m1" meeting={meeting} workspaceId="w1" tab="chat" onTabChange={onTabChange} />,
      ),
    );
    const tab = await screen.findByRole("tab", { name: "Biểu quyết" });
    expect(tabLabels()).toEqual(["UNI", "Trò chuyện", "Mọi người", "Biểu quyết"]);
    fireEvent.click(tab);
    expect(onTabChange).toHaveBeenCalledWith("motions");
  });

  it("keeps the UNI tab mounted while the dock is closed, so a typed note survives", async () => {
    setSessionUser(me);
    const docked = (open: boolean) =>
      wrapWithNav(
        <MeetingSidebarDock open={open}>
          <MeetingRoomSidebar meetingId="m1" meeting={meeting} workspaceId="w1" tab="copilot" onTabChange={() => {}} />
        </MeetingSidebarDock>,
      );
    const { rerender } = render(docked(true));
    fireEvent.click(await screen.findByRole("tab", { name: "Ghi chú" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú mới" }), { target: { value: "Chốt ngân sách" } });

    rerender(docked(false));
    rerender(docked(true));

    expect(screen.getByRole("textbox", { name: "Ghi chú mới" })).toHaveValue("Chốt ngân sách");
  });
});
