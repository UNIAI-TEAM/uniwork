import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { Meeting, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingExitScreen } from "./meeting-exit-screen";

const me: User = {
  id: "u-lan",
  email: "lan@x.com",
  display_name: "Hoàng Lan",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace = { id: "w1", name: "Truyền thông", slug: "team", organization_slug: "demo" } as Workspace;

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Tổng kết dự án Sao Mai",
  description: "",
  starts_at: "2026-10-27T08:40:00Z",
  ends_at: "2026-10-27T09:40:00Z",
  status: "IN_PROGRESS",
  host_user_id: "u-host",
  room_name: "uw_mtg_m1",
  created_by: "u-host",
} as Meeting;

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/participants"))
      return Promise.resolve({
        participants: [
          { id: "p-lan", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", display_name_snapshot: "Hoàng Lan", role: "ATTENDEE", status: "REMOVED", removed_by: "u-host", removed_at: "2026-10-27T08:52:00Z" },
        ],
      });
    if (path.includes("/members"))
      return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "h@x.com", display_name: "Demo UniChat" }] });
    if (path.endsWith("/chat/dm")) return Promise.resolve({ room: { id: "room-dm-1", kind: "dm", name: "Demo UniChat", workspace_id: "w1" } });
    return Promise.resolve({});
  });
});

function renderRemoved({ guest = false } = {}) {
  const nav = fakeNav("/demo/team/meetings/m1/room");
  const screenEl = (
    <MeetingExitScreen
      exit={{ kind: "removed", at: "2026-10-27T08:52:30Z" }}
      meetingId="m1"
      meeting={guest ? undefined : meeting}
      meetingTitle="Tổng kết dự án Sao Mai"
      workspaceId={guest ? undefined : "w1"}
      guestMode={guest}
      selfParticipantId="p-lan"
      onRejoin={vi.fn()}
      onBackToMeeting={vi.fn()}
    />
  );
  render(wrapWithNav(guest ? screenEl : <WorkspaceProvider workspace={workspace} user={me}>{screenEl}</WorkspaceProvider>, nav));
  return nav;
}

describe("leave screen F: removed from the room", () => {
  it("says who removed the viewer and when, and that there is no way back in", async () => {
    renderRemoved();
    expect(await screen.findByRole("heading", { name: "Bạn đã được mời ra khỏi phòng" })).toBeInTheDocument();
    expect(await screen.findByText(/Demo UniChat · \d{2}:52 · Tổng kết dự án Sao Mai/)).toBeInTheDocument();
    expect(screen.getByText("Không vào lại được")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vào lại" })).not.toBeInTheDocument();
  });

  it("opens a direct message with whoever removed the viewer", async () => {
    const nav = renderRemoved();
    fireEvent.click(await screen.findByRole("button", { name: "Nhắn cho chủ trì" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/demo/team/chat?room=room-dm-1"));
    const dm = requestMock.mock.calls.find((c) => String(c[0]).endsWith("/chat/dm"));
    expect(dm?.[1]).toMatchObject({ method: "POST", body: { user_id: "u-host" } });
  });

  it("keeps a guest's screen to the time and the lock, with no name and no message button", async () => {
    renderRemoved({ guest: true });
    expect(await screen.findByRole("heading", { name: "Bạn đã được mời ra khỏi phòng" })).toBeInTheDocument();
    expect(screen.getByText("Không vào lại được")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nhắn cho chủ trì" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Demo UniChat/)).not.toBeInTheDocument();
  });
});
