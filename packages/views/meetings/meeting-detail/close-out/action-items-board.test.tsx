import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { setSessionUser } from "@uniwork/core/auth";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DetailContext } from "../detail-context";
import { demo, demoUser, demoWorkspace, detailValue, routeMeeting, type DemoUserKey, type MeetingFixtureKey } from "../test-fixtures";
import { ActionItemsBoard } from "./action-items-board";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const m1 = demo.meetings.m1;
const base = `/api/v1/meetings/${m1.meeting.id}`;
const projectPath = `/api/v1/workspaces/${demo.workspace.id}/projects/${demo.project.id}`;
const project = {
  id: demo.project.id, organization_id: demo.org.id, workspace_id: demo.workspace.id, title: demo.project.title, description: "",
  status: "in_progress", priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};
// The capture predates S4: "thứ Hai" and "tuần sau" are the server's guesses.
const actionItems = {
  ...m1.action_items,
  items: m1.action_items.items.map((item) =>
    item.status === "PENDING" ? { ...item, suggested_due_guessed: item.due_text === "thứ Hai" || item.due_text === "tuần sau" } : item,
  ),
};

function show(key: MeetingFixtureKey, who: DemoUserKey, convert?: () => Promise<unknown>) {
  routeMeeting(key, { viewer: who, extra: { [`${base}/action-items`]: actionItems, [projectPath]: { project } } });
  const routed = requestMock.getMockImplementation()!;
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    if (init?.method === "POST") {
      if (String(path).endsWith("/convert")) return convert ? convert() : Promise.resolve({ links: [] });
      return Promise.resolve({});
    }
    return routed(path, init);
  });
  setSessionUser(demoUser(who));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={demoWorkspace} user={demoUser(who)}>
        <DetailContext.Provider value={detailValue(key, { user: who })}>
          <ActionItemsBoard />
        </DetailContext.Provider>
      </WorkspaceProvider>,
    ),
  );
}

function convertBodies() {
  return requestMock.mock.calls
    .filter((c) => String(c[0]).endsWith("/action-items/convert"))
    .map((c) => (c[1] as { body: { items: Record<string, unknown>[] } }).body);
}

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockClear();
});

describe("ActionItemsBoard — clerk (Main / AfterAssign)", () => {
  it("draws M1's owner groups with their counts and folds the assigned rows", async () => {
    show("m1", "lan");
    expect(await screen.findByText("9 chờ giao · 5 đã giao")).toBeInTheDocument();
    expect(screen.getByText("Minh Trần · 5 chờ · 2 đã giao")).toBeInTheDocument();
    expect(screen.getByText("Hà Vũ · 3 chờ · 2 đã giao")).toBeInTheDocument();
    expect(screen.getByText("Lan Phạm · 1 chờ · 1 xong")).toBeInTheDocument();
    expect(screen.getByText("Đề xuất 14 việc · chọn việc rồi xem lại trước khi giao")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(9);
    expect(screen.getByRole("button", { name: "Đã giao 1 · 1 xong" })).toHaveAttribute("aria-expanded", "false");
    // A guessed due date wears the warning and says what was heard.
    expect(screen.getByRole("button", { name: "Hạn đoán từ lời nói “thứ Hai”: T2 26/10, kiểm tra hạn" })).toHaveTextContent("~T2 26/10");
    // Nothing is selected until the clerk selects: no bar yet.
    expect(screen.queryByRole("region", { name: "Việc đã chọn" })).toBeNull();
  });

  it("selects explicitly, summarises the selection, and reviews it in the sheet", async () => {
    show("m1", "lan");
    fireEvent.click(await screen.findByRole("button", { name: "Chọn cả 9" }));
    const bar = screen.getByRole("region", { name: "Việc đã chọn" });
    expect(bar).toHaveTextContent("Đã chọn 9 việc");
    expect(bar).toHaveTextContent("3 người · hạn sớm nhất T2 26/10");
    expect(screen.getByRole("button", { name: "Bỏ chọn cả 9" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Phím tắt" })).toBeInTheDocument();
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");

    fireEvent.click(within(bar).getByRole("button", { name: "Xem lại và giao" }));
    const sheet = await screen.findByRole("dialog");
    // Behind the sheet the list shows from its heading, and the list's keys are idle.
    expect(scrolled.mock.contexts).toContain(document.getElementById("action-items"));
    expect(within(bar).queryByRole("button", { name: "Phím tắt", hidden: true })).toBeNull();
    expect(within(bar).getByRole("button", { name: "Bỏ chọn", hidden: true })).toBeInTheDocument();
    scrolled.mockRestore();
    expect(await within(sheet).findByText("Giao 9 việc vào dự án Ra mắt sản phẩm Q4")).toBeInTheDocument();
    expect(within(sheet).getByText("2 hạn được đoán từ lời nói. Kiểm tra trước khi giao.")).toBeInTheDocument();
    expect(within(sheet).getByText("Minh Trần · 5")).toBeInTheDocument();
    expect(within(sheet).getByText(/Người nhận: Minh Trần \(5\), Hà Vũ \(3\), Lan Phạm \(1\)/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Giao 9 việc" })).toBeInTheDocument();
  });

  it("assigns with each row's values and the clerk's override, then says so with no undo", async () => {
    const user = userEvent.setup();
    show("m1", "lan", () => Promise.resolve({ links: [{ action_item_id: "x", task_id: "t" }] }));
    const minhGroup = await screen.findByRole("list", { name: "Việc của Minh Trần" });
    const first = within(minhGroup).getAllByRole("listitem")[0]!;
    await user.click(within(first).getByRole("checkbox"));
    // The owner chip is an inline picker: hand the first row to Hà.
    await user.click(within(first).getByRole("combobox", { name: /Người nhận: Minh Trần/ }));
    await user.click(await screen.findByRole("option", { name: "Hà Vũ" }));
    await user.click(screen.getByRole("button", { name: "Xem lại và giao" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Giao 1 việc" }));

    await waitFor(() => expect(convertBodies()).toHaveLength(1));
    const [row] = convertBodies()[0]!.items;
    expect(row).toMatchObject({
      action_item_id: m1.action_items.items[1]!.id,
      title: "Theo dõi sửa hai lỗi in hóa đơn trên máy in nhiệt khổ 58 mm",
      assignee_id: demo.users.ha.id,
      due_date: "2026-10-27",
      priority: "high",
      project_id: demo.project.id,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã giao 1 việc.", { position: "bottom-center" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a refusal in the sheet, and offers to link a duplicate to its open task", async () => {
    const user = userEvent.setup();
    const itemId = m1.action_items.items[1]!.id;
    show("m1", "lan", () =>
      Promise.reject(
        new ApiError("trùng", "active_duplicate_task", 409, undefined, { action_item_ids: [itemId], task_id: "t-open", title: "Theo dõi" }),
      ),
    );
    const minhGroup = await screen.findByRole("list", { name: "Việc của Minh Trần" });
    await user.click(within(minhGroup).getAllByRole("checkbox")[0]!);
    await user.click(screen.getByRole("button", { name: "Xem lại và giao" }));
    const sheet = await screen.findByRole("dialog");
    await user.click(within(sheet).getByRole("button", { name: "Giao 1 việc" }));
    expect(await within(sheet).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Gắn với việc đang mở" }));
    await waitFor(() =>
      expect(requestMock.mock.calls.some((c) => String(c[0]).endsWith(`/action-items/${itemId}/link`))).toBe(true),
    );
  });

  it("walks the rows with the arrows and opens the review with Ctrl+Enter", async () => {
    show("m1", "lan");
    const boxes = await screen.findAllByRole("checkbox");
    boxes[0]!.focus();
    fireEvent.keyDown(boxes[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(boxes[1]);
    fireEvent.keyDown(boxes[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(boxes[0]);
    // Composing Vietnamese never moves anything.
    fireEvent.keyDown(boxes[0]!, { key: "ArrowDown", keyCode: 229 });
    expect(document.activeElement).toBe(boxes[0]);
    fireEvent.click(boxes[0]!);
    fireEvent.keyDown(boxes[0]!, { key: "Enter", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("ActionItemsBoard — member and outsider", () => {
  it("shows a member its own items first and who will assign the rest, read-only", async () => {
    show("m1", "minh");
    expect(await screen.findByText("Đã giao cho bạn · 2")).toBeInTheDocument();
    expect(screen.getByText("Chờ giao · 5")).toBeInTheDocument();
    expect(screen.getAllByText("Chờ Lan Phạm hoặc Hà Vũ giao")).toHaveLength(5);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("radio", { name: /Của bạn/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Tất cả/ }));
    expect(screen.getByText("Minh Trần (bạn) · 5 chờ · 2 đã giao")).toBeInTheDocument();
    expect(screen.getByText("Lan Phạm · 1 chờ · 1 xong")).toBeInTheDocument();
  });

  it("shows an outsider only the assigned tasks, with no pending counts", async () => {
    show("m1Outsider", "tuan");
    expect(await screen.findByText("Việc đã giao")).toBeInTheDocument();
    expect(screen.getByText("5 · 1 xong")).toBeInTheDocument();
    expect(screen.getByText("Các việc khác chỉ người dự họp xem được.")).toBeInTheDocument();
    expect(screen.queryByText(/chờ/)).toBeNull();
    expect(screen.getByRole("link", { name: "Mở công việc: Xong · T6 23/10" })).toBeInTheDocument();
  });
});
