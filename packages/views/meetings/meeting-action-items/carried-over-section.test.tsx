import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingCarriedOverSection } from "./carried-over-section";

beforeAll(() => {
  initI18n();
});

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};
const user = { id: "u-host", email: "host@x.com", display_name: "Host" } as User;

const lastWeek = { id: "m0", title: "Giao ban tuần 41", started_at: "2026-10-06T02:00:00Z" };
const twoWeeksAgo = { id: "m-1", title: "Giao ban tuần 40", started_at: "2026-09-29T02:00:00Z" };
// Due-sorted as the server sends them: the groups follow the first task of each.
const items = [
  {
    action_item_id: "a1",
    meeting: twoWeeksAgo,
    task: { id: "t1", title: "Gửi báo giá", status: "todo", done: false, overdue: true, assignee_id: "u-mai", due_date: "2026-10-01" },
  },
  {
    action_item_id: "a2",
    meeting: lastWeek,
    task: { id: "t2", title: "Đặt phòng hội thảo", status: "in_progress", done: false, overdue: false, assignee_id: null, due_date: "2026-10-30" },
  },
  {
    action_item_id: "a3",
    meeting: twoWeeksAgo,
    task: { id: "t3", title: "In tài liệu", status: "todo", done: false, overdue: false, assignee_id: null, due_date: null },
  },
];

function respond(carried: unknown) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/carried-over-items")) return Promise.resolve(carried);
    if (p.endsWith("/members")) {
      return Promise.resolve({
        members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
      });
    }
    return Promise.resolve({});
  });
}

function renderSection() {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <div data-testid="host">
          <MeetingCarriedOverSection workspaceId="w1" meetingId="m1" variant="compact" />
        </div>
      </WorkspaceProvider>,
    ),
  );
}

describe("MeetingCarriedOverSection", () => {
  it("groups the open tasks by the meeting that assigned them, each linked", async () => {
    respond({ items });
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Việc còn tồn (3)" }));
    const older = await screen.findByRole("region", { name: "Từ cuộc họp Giao ban tuần 40" });
    const newer = screen.getByRole("region", { name: "Từ cuộc họp Giao ban tuần 41" });
    expect(screen.queryByText(/chưa hiện ở đây/)).not.toBeInTheDocument();
    // The group whose task is due first heads the list.
    expect(older.compareDocumentPosition(newer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(older).getByRole("link", { name: "Giao ban tuần 40" })).toHaveAttribute("href", "/org/team/meetings/m-1");
    expect(within(older).getByRole("link", { name: 'Mở việc "Gửi báo giá"' })).toHaveAttribute("href", "/org/team/tasks/t1");
    expect(within(older).getByText("In tài liệu")).toBeInTheDocument();
    expect(await within(older).findByText("Mai Anh")).toBeInTheDocument();
    expect(within(older).getByText("Quá hạn")).toBeInTheDocument();
    expect(within(newer).getByText("Đặt phòng hội thảo")).toBeInTheDocument();
    expect(within(newer).getByText("Chưa giao")).toBeInTheDocument();
  });

  it("counts the tasks beyond the page and says how many more there are", async () => {
    respond({ items, total: 105 });
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Việc còn tồn (105)" }));
    expect(screen.getByText("Còn 102 việc nữa chưa hiện ở đây.")).toBeInTheDocument();
  });

  it("renders nothing when nothing carries over, or the answer is unreadable", async () => {
    respond({ items: [] });
    const { unmount } = renderSection();
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/carried-over-items"));
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
    unmount();
    respond({ items: "nope" });
    renderSection();
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.getByTestId("host")).toBeEmptyDOMElement();
  });

  it("says the list did not load and retries, instead of vanishing", async () => {
    requestMock.mockReset();
    let fail = true;
    requestMock.mockImplementation((path: unknown) => {
      const p = String(path);
      if (p.endsWith("/carried-over-items")) {
        return fail ? Promise.reject(new ApiError("nope", "forbidden", 403)) : Promise.resolve({ items });
      }
      return Promise.resolve({});
    });
    renderSection();
    expect(await screen.findByText("Chưa tải được việc còn tồn từ các cuộc họp trước.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("button", { name: "Việc còn tồn (3)" })).toBeInTheDocument();
  });

  it("folds into one group in the Copilot until opened", async () => {
    respond({ items });
    renderSection();
    const toggle = await screen.findByRole("button", { name: "Việc còn tồn (3)" });
    expect(screen.queryByText("Gửi báo giá")).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(await screen.findByText("Gửi báo giá")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Từ cuộc họp Giao ban tuần 41" })).toBeInTheDocument();
  });
});
