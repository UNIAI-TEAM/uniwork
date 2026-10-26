import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { Task, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { TaskDetailContextLine } from "./task-detail-context-line";

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTask: () => ({ data: undefined }),
    useChildTaskProgress: () => ({ data: [] }),
  };
});

const me: User = {
  id: "u1",
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

const task = (origin: Partial<Task>) =>
  ({ id: "t1", title: "Việc", workspace_id: "w1", ...origin }) as Task;

function renderLine(t: Task) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={me}>
        <TaskDetailContextLine workspaceId="w1" task={t} />
      </WorkspaceProvider>,
    ),
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  requestMock.mockReset();
});

describe("TaskDetailContextLine — meeting origin", () => {
  it("names the meeting and its day, linking to the meeting", async () => {
    requestMock.mockResolvedValue({
      meeting: {
        id: "m1",
        workspace_id: "w1",
        title: "Họp giao ban",
        description: "",
        starts_at: "2025-10-15T09:00:00",
        ends_at: "2025-10-15T10:00:00",
        room_name: "r",
        created_by: "u1",
      },
    });
    renderLine(task({ origin_type: "meeting", origin_id: "m1" }));

    const link = await screen.findByRole("link", { name: /Từ cuộc họp.*Họp giao ban/ });
    expect(link).toHaveAttribute("href", "/org/team/meetings/m1");
    // The task page's own short date, with the year for another year.
    expect(link).toHaveTextContent(/15 thg 10, 2025/);
    // The title is the part that gives way; the label and the date never do.
    expect(screen.getByText("Họp giao ban")).toHaveClass("truncate");
    expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1");
  });

  it("holds the line's place while the meeting loads", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderLine(task({ origin_type: "meeting", origin_id: "m1" }));

    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
  });

  it.each([
    [new ApiError("gone", "not_found", 404), "Cuộc họp đã bị xóa"],
    [new ApiError("forbidden", "forbidden", 403), "Bạn không có quyền xem cuộc họp này"],
    [new Error("offline"), "Không tải được cuộc họp. Tải lại trang để thử lại."],
  ])("says why the meeting cannot be shown: %s", async (err, text) => {
    requestMock.mockRejectedValue(err);
    renderLine(task({ origin_type: "meeting", origin_id: "m1" }));

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows nothing and reads no meeting for another origin", () => {
    const { container } = renderLine(task({ origin_type: "chat_message", origin_id: "c1" }));

    expect(container).toBeEmptyDOMElement();
    expect(requestMock).not.toHaveBeenCalled();
  });
});
