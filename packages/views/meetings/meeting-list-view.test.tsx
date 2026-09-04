import { render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const meetings: Meeting[] = [
  {
    id: "m1",
    workspace_id: "w1",
    title: "Standup",
    description: "",
    starts_at: "2026-09-10T02:00:00Z",
    ends_at: "2026-09-10T02:30:00Z",
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
    starts_at: "2026-09-10T02:00:00Z",
    ends_at: "2026-09-10T03:00:00Z",
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

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
  requestMock.mockImplementation((path: unknown) => {
    if (String(path).endsWith("/members")) {
      return Promise.resolve({
        members: [{ workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" }],
      });
    }
    return Promise.resolve({});
  });
});

describe("MeetingList", () => {
  it("renders grouped rows with host names and join actions", async () => {
    render(shell(<MeetingList workspaceId="w1" meetings={meetings} onOpenRoom={() => {}} />));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Standup")).toBeInTheDocument();
    expect(within(table).getByText("Retro")).toBeInTheDocument();
    expect(await within(table).findAllByText("Me")).toHaveLength(2);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const retroRow = rows.find((row) => within(row).queryByText("Retro"));
    expect(within(retroRow!).getByRole("button", { name: "Vào ngay" })).toBeInTheDocument();
  });

  it("marks today's meetings in the day heading", async () => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayMeeting: Meeting = {
      ...meetings[0]!,
      starts_at: `${day}T02:00:00Z`,
      ends_at: `${day}T02:30:00Z`,
    };
    render(shell(<MeetingList workspaceId="w1" meetings={[todayMeeting]} onOpenRoom={() => {}} />));
    expect(await screen.findByText("Hôm nay")).toBeInTheDocument();
  });
});
