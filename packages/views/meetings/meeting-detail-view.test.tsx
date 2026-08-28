import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingDetailView } from "./meeting-detail-view";
import { MeetingRoomView } from "./room-view";

initI18n();

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

const meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  description: "agenda",
  starts_at: "2026-08-28T02:00:00Z",
  ends_at: "2026-08-28T02:30:00Z",
  room_name: "uw_mtg_m1",
  created_by: "u-host",
  status: "SCHEDULED",
  host_user_id: "u-host",
};

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
});

describe("MeetingDetailView", () => {
  it("shows host start and cancel, and the join lobby entry", async () => {
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/members")) {
        return Promise.resolve({ members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" }] });
      }
      if (p === "/api/v1/meetings/m1") return Promise.resolve({ meeting });
      if (p.endsWith("/notes")) return Promise.resolve({ notes: [] });
      if (p.endsWith("/invitations")) return Promise.resolve({ invitations: [] });
      if (p.endsWith("/participants")) return Promise.resolve({ participants: [] });
      if (p.endsWith("/join-requests")) return Promise.resolve({ join_requests: [] });
      return Promise.resolve({});
    });
    render(shell(<MeetingDetailView workspaceId="w1" meetingId="m1" onJoin={() => {}} onDeleted={() => {}} />));
    expect(await screen.findByRole("button", { name: "Bắt đầu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bắt đầu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vào phòng họp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Huỷ cuộc họp" })).toBeInTheDocument();
  });
});

describe("MeetingRoomView", () => {
  it("shows waiting-for-host when admission does not admit", async () => {
    requestMock.mockResolvedValue({ decision: "WAITING_FOR_HOST", reason: "MEETING_NOT_STARTED", meeting_status: "SCHEDULED" });
    render(shell(<MeetingRoomView meetingId="m1" onLeave={() => {}} />));
    await waitFor(() => expect(screen.getByText("Đang chờ người chủ trì bắt đầu cuộc họp")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Rời phòng" }));
  });
});
