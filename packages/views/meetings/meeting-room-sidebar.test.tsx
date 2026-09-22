import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingRoomSidebar, MeetingSidebarDock } from "./meeting-room-sidebar";

vi.mock("@livekit/components-react", () => ({
  useLocalParticipant: () => ({ localParticipant: { identity: "u-me" } }),
  useChat: () => ({ chatMessages: [], send: vi.fn(), isSending: false }),
  useParticipants: () => [],
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) =>
    String(path).endsWith("/recordings") ? Promise.resolve({ recordings: [] }) : Promise.resolve({}),
  );
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
    const tab = screen.getByRole("tab", { name: "Chat" });
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAccessibleName("Chat");
  });

  it("names the recordings tab for what it lists", async () => {
    const onTabChange = vi.fn();
    const { rerender } = render(
      wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="chat" onTabChange={onTabChange} guestMode />),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Bản ghi" }));
    expect(onTabChange).toHaveBeenCalledWith("recordings");
    rerender(
      wrapWithNav(<MeetingRoomSidebar meetingId="m1" tab="recordings" onTabChange={onTabChange} guestMode />),
    );
    expect(await screen.findByText(/Chưa có bản ghi/)).toBeInTheDocument();
    expect(screen.queryByText(/Tệp được chia sẻ/)).not.toBeInTheDocument();
  });
});
