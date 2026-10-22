import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingActionItemsSection } from "./meeting-action-items-section";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

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

const pendingAI = {
  id: "a0",
  source: "AI",
  title: "Gửi biên bản",
  owner_text: "Mai Anh",
  due_text: "thứ Sáu",
  suggested_assignee_id: "u-mai",
  suggested_due_date: "2026-09-25",
  status: "PENDING",
  evidence: [{ kind: "segment", id: "g1" }],
};
const pendingManual = { id: "a1", source: "MANUAL", title: "Đặt phòng", status: "PENDING" };
const converted = {
  id: "a2",
  source: "AI",
  title: "Báo khách",
  status: "CONVERTED",
  task: { id: "t9", title: "Báo khách hàng", status: "todo", done: false, overdue: true, assignee_id: "u-mai", due_date: "2026-09-20" },
  evidence: [
    { kind: "note", id: "n1" },
    { kind: "chat", id: "c1" },
  ],
};
const dismissed = { id: "a3", source: "AI", title: "In tài liệu", status: "DISMISSED", dismiss_reason: "Đã có bản in" };
const list = {
  items: [pendingAI, pendingManual, converted, dismissed],
  counts: { pending: 2, converted: 1, dismissed: 1, tasks_done: 0, tasks_overdue: 1 },
};
const project = {
  id: "p1", organization_id: "o1", workspace_id: "w1", title: "Ra mắt Q4", description: "", status: "in_progress",
  priority: "none", revision: 1, task_count: 0, done_count: 0, resource_count: 0,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
};

function respond(opts: { convert?: () => Promise<unknown>; items?: () => unknown } = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/action-items/convert") && init?.method === "POST") {
      return opts.convert ? opts.convert() : Promise.resolve({ links: [{ action_item_id: "a0", task_id: "t1" }] });
    }
    if (init?.method === "POST") return Promise.resolve({ status: "ok", item: { ...pendingManual, id: "a9", title: "Mới" } });
    if (p.endsWith("/action-items")) return Promise.resolve(opts.items ? opts.items() : list);
    if (p.includes("/projects/p1")) return Promise.resolve({ project });
    if (p.endsWith("/members")) {
      return Promise.resolve({
        members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
      });
    }
    return Promise.resolve({});
  });
}

function posts(suffix: string): { path: string; body: unknown }[] {
  return requestMock.mock.calls
    .filter((c) => String(c[0]).endsWith(suffix) && (c[1] as { method?: string } | undefined)?.method === "POST")
    .map((c) => ({ path: String(c[0]), body: (c[1] as { body?: unknown } | undefined)?.body }));
}

function renderSection(props: { canClerk?: boolean; projectId?: string } = {}) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <MeetingActionItemsSection workspaceId="w1" meetingId="m1" canClerk={props.canClerk ?? true} projectId={props.projectId} />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(() => {
  respond();
});

describe("MeetingActionItemsSection", () => {
  it("shows the groups with their counts, each task's state, and folds the dismissed ones", async () => {
    renderSection();
    expect(await screen.findByRole("heading", { name: "Chờ xử lý (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Đã giao (1)" })).toBeInTheDocument();
    // No row of count chips repeating the headings ("Đã bỏ qua 0" and all).
    expect(screen.queryByText("Chờ xử lý 2")).not.toBeInTheDocument();
    expect(screen.getByText(/Đã xong 0\/1/)).toBeInTheDocument();
    expect(screen.getByText("1 quá hạn")).toBeInTheDocument();

    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).toBeInTheDocument();
    expect(screen.getByText("Thêm tay")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: 'Mở việc "Báo khách hàng"' });
    expect(link).toHaveAttribute("href", expect.stringContaining("t9"));
    expect(screen.getByText("Quá hạn")).toHaveClass("text-destructive");
    // AI items carry their evidence chip (UNI-2002); the manual one has none.
    expect(screen.getByRole("button", { name: "Căn cứ 1 nguồn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Căn cứ 2 nguồn" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Căn cứ \d/ })).toHaveLength(2);

    expect(screen.queryByText("In tài liệu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đã bỏ qua \(1\)/ }));
    expect(await screen.findByText("In tài liệu")).toBeInTheDocument();
    expect(screen.getByText("Lý do: Đã có bản in")).toBeInTheDocument();
  });

  it("labels an item the AI scribe heard during the meeting as the scribe's, with its time", async () => {
    const live = { id: "a5", source: "LIVE", title: "Gửi báo giá", status: "PENDING", created_at: "2026-10-21T03:42:00Z" };
    const noTime = { id: "a6", source: "LIVE", title: "Chốt lịch", status: "PENDING", created_at: "not a time" };
    respond({ items: () => ({ items: [live, noTime], counts: { pending: 2, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 } }) });
    renderSection();
    expect(await screen.findByText("Gửi báo giá")).toBeInTheDocument();
    expect(screen.getByText(/^Thư ký AI ghi lúc \d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText("Thư ký AI ghi trong họp")).toBeInTheDocument();
  });

  it("is read-only for a member who is not a clerk", async () => {
    renderSection({ canClerk: false });
    expect(await screen.findByText("Gửi biên bản")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Giao|Thêm việc|Bỏ qua "/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đã bỏ qua \(1\)/ }));
    expect(await screen.findByText("In tài liệu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Khôi phục/ })).not.toBeInTheDocument();
  });

  it("asks for a pick before reviewing, keeping the button reachable", async () => {
    renderSection();
    // Never "Assign 0 tasks": the plain verb, quiet until something is ticked.
    const cta = await screen.findByRole("button", { name: "Giao việc" });
    expect(cta).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(cta.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      "Chọn ít nhất một việc đang chờ xử lý",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Gửi biên bản" }));
    // Busy only while the ticked item's cited lines are read, then ready.
    await waitFor(() => expect(screen.getByRole("button", { name: "Giao 1 việc" })).not.toHaveAttribute("aria-disabled"));
  });

  it("ticks an item from its title, not only from the 16px box", async () => {
    renderSection();
    fireEvent.click(await screen.findByText("Gửi biên bản"));
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).toBeChecked();
  });

  it("says who, when and how urgent once, on the line of what Assign applies", async () => {
    // "Mai" was said of Mai Anh and "thứ Sáu" became a date: neither is repeated above the suggestion.
    respond({ items: () => ({ ...list, items: [{ ...pendingAI, owner_text: "Mai", suggested_priority: "high" }] }) });
    renderSection();
    expect(await screen.findByText(/^Gợi ý giao: Mai Anh · hạn .+ · ưu tiên cao$/)).toBeInTheDocument();
    expect(screen.queryByText("thứ Sáu")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Mai\b/)).not.toBeInTheDocument();
  });

  it("keeps what was said when the suggestion names someone else", async () => {
    respond({ items: () => ({ ...list, items: [{ ...pendingAI, owner_text: "anh Hùng" }] }) });
    renderSection();
    expect(await screen.findByText(/^Gợi ý giao: Mai Anh/)).toBeInTheDocument();
    expect(screen.getByText("anh Hùng")).toBeInTheDocument();
  });

  it("says a task nobody started has not started, without the done check", async () => {
    const todo = { ...converted, task: { ...converted.task, overdue: false } };
    respond({ items: () => ({ items: [todo], counts: { pending: 0, converted: 1, dismissed: 0, tasks_done: 0, tasks_overdue: 0 } }) });
    renderSection();
    expect(await screen.findByText("Chưa bắt đầu")).toBeInTheDocument();
    expect(screen.queryByText("Đang làm")).not.toBeInTheDocument();
  });

  it("assigns the ticked items at once, on the meeting's suggestions, the AI's prose and the cited lines", async () => {
    const described = { ...pendingAI, description: "Gửi biên bản cho cả nhóm trước thứ Sáu.", suggested_priority: "high" };
    respond({ items: () => ({ ...list, items: [described, pendingManual, converted, dismissed] }) });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      String(path).includes("/evidence?refs=")
        ? Promise.resolve({ items: [{ kind: "segment", id: "g1", author: "Mai Anh", text: "Em gửi biên bản nhé", at: "2026-09-22T03:05:00Z" }] })
        : base(path, init),
    );
    renderSection({ projectId: "p1" });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Đặt phòng" }));
    await waitFor(() => expect(requestMock.mock.calls.some((c) => String(c[0]).includes("/projects/p1"))).toBe(true));
    // No form in between: the ticks become tasks in one call.
    await waitFor(() => expect(screen.getByRole("button", { name: "Giao 2 việc" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Giao 2 việc" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await waitFor(() => expect(posts("/action-items/convert")).toHaveLength(1));
    const body = posts("/action-items/convert")[0]!.body as { items: Record<string, unknown>[]; locale: string };
    expect(body.locale).toBe("vi");
    expect(body.items[0]).toMatchObject({
      action_item_id: "a0", title: "Gửi biên bản", priority: "high", assignee_id: "u-mai", due_date: "2026-09-25", project_id: "p1",
    });
    expect(String(body.items[0]!.description)).toContain("Gửi biên bản cho cả nhóm trước thứ Sáu.");
    expect(String(body.items[0]!.description)).toContain("Em gửi biên bản nhé");
    expect(body.items[1]).toMatchObject({ action_item_id: "a1", title: "Đặt phòng", assignee_id: null, due_date: null, project_id: "p1" });
    // One channel for the outcome, in the same words as the button.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã giao 1 việc.", expect.anything()));
    expect(screen.getByTestId("summary-live-region")).not.toHaveTextContent("Đã giao");
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).not.toBeChecked();
  });

  it("names the items that duplicate an open task and keeps the ticks for the clerk to change", async () => {
    vi.mocked(toast.error).mockClear();
    respond({ convert: () => Promise.reject(new ApiError("x", "active_duplicate_task", 409, undefined, { action_item_ids: ["a0"] })) });
    renderSection();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Giao 1 việc" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Giao 1 việc" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Đã có việc đang mở trùng tên với: "Gửi biên bản". Bỏ chọn các mục này hoặc chọn dự án khác rồi thử lại.',
      ),
    );
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).toBeChecked();
  });

  it("drops the ticks when an item was handled elsewhere meanwhile", async () => {
    vi.mocked(toast.error).mockClear();
    respond({ convert: () => Promise.reject(new ApiError("x", "action_item_not_pending", 409, undefined, { action_item_ids: ["a0"] })) });
    renderSection();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Giao 1 việc" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Giao 1 việc" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Có việc đã được giao hoặc bỏ qua trước đó. Danh sách đã cập nhật, chọn lại các việc còn chờ xử lý.",
      ),
    );
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).not.toBeChecked();
  });

  it("dismisses an item with an optional reason", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Lý do (không bắt buộc)" }), { target: { value: " Trùng " } });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua việc" }));
    await waitFor(() => expect(posts("/a1/dismiss")).toHaveLength(1));
    expect(posts("/a1/dismiss")[0]!.body).toEqual({ reason: "Trùng" });
    await waitFor(() => expect(screen.getByTestId("summary-live-region")).toHaveTextContent("Đã bỏ qua việc."));
  });

  it("restores a dismissed item", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Đã bỏ qua \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: 'Khôi phục "In tài liệu"' }));
    await waitFor(() => expect(posts("/a3/restore")).toHaveLength(1));
  });

  it("opens a row in the task screen's composer on its values, to change before assigning", async () => {
    const described = { ...pendingAI, description: "Gửi biên bản cho cả nhóm trước thứ Sáu.", suggested_priority: "high" };
    respond({ items: () => ({ ...list, items: [described, pendingManual, converted, dismissed] }) });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      String(path).includes("/evidence?refs=")
        ? Promise.resolve({ items: [{ kind: "segment", id: "g1", author: "Mai Anh", text: "Em gửi biên bản nhé", at: "2026-09-22T03:05:00Z" }] })
        : base(path, init),
    );
    renderSection({ projectId: "p1" });
    const row = (await screen.findByRole("checkbox", { name: "Gửi biên bản" })).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Sửa & giao" }));
    const dialog = await screen.findByRole("dialog");
    const title = within(dialog).getByRole("textbox", { name: "Tiêu đề issue" });
    await waitFor(() => expect(title).toHaveValue("Gửi biên bản"));
    expect(within(dialog).getByText("Em gửi biên bản nhé")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Độ ưu tiên: Cao" })).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Gửi biên bản họp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Tạo/ }));
    await waitFor(() => expect(posts("/action-items/convert")).toHaveLength(1));
    expect((posts("/action-items/convert")[0]!.body as { items: unknown[] }).items[0]).toMatchObject({
      action_item_id: "a0", title: "Gửi biên bản họp", priority: "high", assignee_id: "u-mai", project_id: "p1",
    });
    expect(posts("/meetings/m1/action-items")).toHaveLength(0);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã giao 1 việc.", expect.anything()));
  });

  it("adds a task through the task screen's composer: a hand-added item, converted with what was typed", async () => {
    renderSection({ projectId: "p1" });
    fireEvent.click(await screen.findByRole("button", { name: "Thêm task" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Task sau họp")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Tiêu đề issue" }), { target: { value: " Gọi khách " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Tạo/ }));
    await waitFor(() => expect(posts("/meetings/m1/action-items")).toHaveLength(1));
    expect(posts("/meetings/m1/action-items")[0]!.body).toEqual({ title: "Gọi khách" });
    await waitFor(() => expect(posts("/action-items/convert")).toHaveLength(1));
    expect((posts("/action-items/convert")[0]!.body as { items: unknown[] }).items[0]).toMatchObject({
      action_item_id: "a9", title: "Gọi khách", project_id: "p1",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Thêm task" })).toHaveFocus());
  });

  it("invites a clerk to add the first item when there is none", async () => {
    respond({ items: () => ({ items: [], counts: { pending: 0, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 } }) });
    renderSection();
    expect(await screen.findByText("Chưa có việc cần làm. Thêm việc để giao sau họp.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm task" })).toBeInTheDocument();
  });
});

describe("MeetingActionItemsSection source labels", () => {
  it("labels what the AI drew from the summary, on every group", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Đã bỏ qua \(1\)/ }));
    await screen.findByText("In tài liệu");
    // Pending, assigned and dismissed AI rows all keep their source.
    expect(screen.getAllByText("Từ tóm tắt AI")).toHaveLength(3);
    // The label stays out of the checkbox's name.
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" })).toBeInTheDocument();
  });
});

describe("MeetingActionItemsSection focus", () => {
  const counts = { pending: 0, converted: 0, dismissed: 0, tasks_done: 0, tasks_overdue: 0 };
  /** The list the server answers, switched once the command lands. */
  function respondThen(before: unknown[], after: unknown[], fail?: string) {
    let current = before;
    respond({ items: () => ({ items: current, counts }) });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (init?.method === "POST" && fail && String(path).endsWith(fail)) return Promise.reject(new Error("boom"));
      if (init?.method === "POST") current = after;
      return base(path, init);
    });
  }

  it("moves to the next pending row once a dismissed one leaves the list", async () => {
    const third = { id: "a4", source: "AI", title: "Chốt lịch", status: "PENDING" };
    respondThen([pendingAI, pendingManual, third], [pendingAI, { ...pendingManual, status: "DISMISSED" }, third]);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    expect(await screen.findByRole("dialog", { name: "Bỏ qua việc này?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua việc" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Chốt lịch" })).toHaveFocus());
  });

  it("still lands on the next row when the dismiss is refused because another clerk assigned it", async () => {
    vi.mocked(toast.error).mockClear();
    const third = { id: "a4", source: "AI", title: "Chốt lịch", status: "PENDING" };
    let current: unknown[] = [pendingAI, pendingManual, third];
    respond({ items: () => ({ items: current, counts }) });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (init?.method === "POST" && String(path).endsWith("/dismiss")) {
        current = [pendingAI, { ...pendingManual, status: "CONVERTED", task_id: "t9" }, third];
        return Promise.reject(new ApiError("x", "action_item_not_pending", 409));
      }
      return base(path, init);
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ qua việc" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Chốt lịch" })).toHaveFocus());
    expect(toast.error).toHaveBeenCalledWith("Việc này vừa được người khác xử lý. Danh sách đã cập nhật.");
  });

  it("lands on Add item when the last pending row is dismissed", async () => {
    respondThen([pendingManual], [{ ...pendingManual, status: "DISMISSED" }]);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ qua việc" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Thêm task" })).toHaveFocus());
  });

  it("follows a restored item back to its pending row", async () => {
    respondThen([pendingAI, dismissed], [pendingAI, { ...dismissed, status: "PENDING" }]);
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Đã bỏ qua \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: 'Khôi phục "In tài liệu"' }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "In tài liệu" })).toHaveFocus());
  });

  it("keeps the assign button, and the focus on it, once every pending item is assigned", async () => {
    const u = userEvent.setup();
    respondThen([pendingAI], [{ ...converted, id: "a0", title: pendingAI.title }]);
    renderSection();
    await u.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    await u.click(screen.getByRole("button", { name: "Giao 1 việc" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Đã giao (1)" })).toBeInTheDocument());
    const cta = screen.getByRole("button", { name: "Giao việc" });
    await waitFor(() => expect(cta).toHaveFocus());
    expect(cta).toHaveAttribute("aria-disabled", "true");
    // The reason is on screen, not only for a screen reader.
    const reason = document.getElementById(cta.getAttribute("aria-describedby") ?? "");
    expect(reason).toHaveTextContent("Không còn việc nào chờ giao");
    expect(reason).not.toHaveClass("sr-only");
  });
});

describe("MeetingActionItemsSection errors", () => {
  it("shows a failed dismiss in its popover and a failed restore beside its row", async () => {
    vi.mocked(toast.error).mockClear();
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) =>
      init?.method === "POST" ? Promise.reject(new Error("boom")) : base(path, init),
    );
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ qua việc" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa bỏ qua được việc. Thử lại.");
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));

    fireEvent.click(screen.getByRole("button", { name: /Đã bỏ qua \(1\)/ }));
    fireEvent.click(await screen.findByRole("button", { name: 'Khôi phục "In tài liệu"' }));
    await waitFor(() => expect(screen.getByText("Chưa khôi phục được việc. Thử lại.")).toHaveAttribute("role", "alert"));
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("MeetingActionItemsSection announcements", () => {
  it("announces a second identical dismiss again: the region empties, then refills", async () => {
    renderSection();
    const region = () => screen.getByTestId("summary-live-region");
    fireEvent.click(await screen.findByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ qua việc" }));
    await waitFor(() => expect(region()).toHaveTextContent("Đã bỏ qua việc."));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Bỏ qua việc" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    const confirm = await screen.findByRole("button", { name: "Bỏ qua việc" });
    vi.useFakeTimers();
    try {
      fireEvent.click(confirm);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(posts("/a1/dismiss")).toHaveLength(2);
      expect(region()).toBeEmptyDOMElement();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(region()).toHaveTextContent("Đã bỏ qua việc.");
    } finally {
      vi.useRealTimers();
    }
  });
});
