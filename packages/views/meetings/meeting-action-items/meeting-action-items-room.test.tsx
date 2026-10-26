import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  suggested_assignee_id: "u-mai",
  suggested_due_date: "2026-09-25",
  status: "PENDING",
};
const pendingManual = { id: "a1", source: "MANUAL", title: "Đặt phòng", status: "PENDING" };
const pendingLive = { id: "a4", source: "LIVE", title: "Gửi báo giá", status: "PENDING", created_at: "2026-10-21T03:42:00Z" };
const converted = {
  id: "a2",
  source: "AI",
  title: "Báo khách",
  status: "CONVERTED",
  task: { id: "t9", title: "Báo khách hàng", status: "todo", done: false, overdue: false, assignee_id: "u-mai", due_date: null },
};
const dismissed = { id: "a3", source: "AI", title: "In tài liệu", status: "DISMISSED" };
const list = {
  items: [pendingAI, pendingManual, pendingLive, converted, dismissed],
  counts: { pending: 3, converted: 1, dismissed: 1, tasks_done: 0, tasks_overdue: 0 },
};

function respond() {
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/action-items/convert") && init?.method === "POST") {
      return Promise.resolve({ links: [{ action_item_id: "a0", task_id: "t1" }, { action_item_id: "a1", task_id: "t2" }] });
    }
    if (init?.method === "POST") return Promise.resolve({ status: "ok" });
    if (p.endsWith("/action-items")) return Promise.resolve(list);
    if (p.endsWith("/members")) {
      return Promise.resolve({
        members: [{ workspace_id: "w1", user_id: "u-mai", role: "member", email: "mai@x.com", display_name: "Mai Anh" }],
      });
    }
    return Promise.resolve({});
  });
}

function posts(suffix: string): unknown[] {
  return requestMock.mock.calls
    .filter((c) => String(c[0]).endsWith(suffix) && (c[1] as { method?: string } | undefined)?.method === "POST")
    .map((c) => (c[1] as { body?: unknown }).body);
}

function renderRoom(
  props: { canClerk?: boolean; editItemId?: string; onEditHandled?: () => void; onSelectionChange?: (count: number) => void } = {},
) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <MeetingActionItemsSection
          workspaceId="w1"
          meetingId="m1"
          variant="room"
          canClerk={props.canClerk ?? true}
          editItemId={props.editItemId}
          onEditHandled={props.onEditHandled}
          onSelectionChange={props.onSelectionChange}
        />
      </WorkspaceProvider>,
    ),
  );
}

beforeEach(() => {
  respond();
});

describe("MeetingActionItemsSection in the room", () => {
  it("lets the clerk tick items, then assign them from the floating bar or clear the ticks", async () => {
    const onSelectionChange = vi.fn();
    renderRoom({ onSelectionChange });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Đặt phòng" }));
    expect(screen.getByText("2 đã chọn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giao 2 việc" })).toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith(2);
    // Ticked rows wear the brand tint.
    expect(screen.getByRole("checkbox", { name: "Gửi biên bản" }).closest("li")).toHaveClass("bg-brand-subtle/50");

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(screen.queryByText("2 đã chọn")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Giao \d việc$/ })).not.toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenLastCalledWith(0);
  });

  it("assigns the ticked items through the same convert call", async () => {
    renderRoom();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Gửi biên bản" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Đặt phòng" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Giao 2 việc" })).not.toHaveAttribute("aria-busy"));
    fireEvent.click(screen.getByRole("button", { name: "Giao 2 việc" }));
    await waitFor(() => expect(posts("/action-items/convert")).toHaveLength(1));
    const body = posts("/action-items/convert")[0] as { items: { action_item_id: string }[] };
    expect(body.items.map((i) => i.action_item_id)).toEqual(["a0", "a1"]);
    await waitFor(() => expect(screen.queryByText("2 đã chọn")).not.toBeInTheDocument());
  });

  it("ticks every pending item at once from the group heading", async () => {
    renderRoom();
    const all = await screen.findByRole("checkbox", { name: "Chọn tất cả việc chờ xử lý" });
    expect(screen.getByRole("heading", { name: "Chờ xử lý (3)" })).toBeInTheDocument();
    fireEvent.click(all);
    expect(screen.getByText("3 đã chọn")).toBeInTheDocument();
    expect(all).toBeChecked();
    fireEvent.click(all);
    expect(screen.queryByText("3 đã chọn")).not.toBeInTheDocument();
  });

  it("shows who and when as chips, and the scribe's mark with the time on what it heard", async () => {
    renderRoom();
    const row = (await screen.findByRole("checkbox", { name: "Gửi biên bản" })).closest("li")!;
    expect(await within(row).findByText("Mai Anh")).toBeInTheDocument();
    expect(within(row).getByText(/^Thứ Sáu/)).toBeInTheDocument();
    const bare = screen.getByRole("checkbox", { name: "Đặt phòng" }).closest("li")!;
    expect(within(bare).getByRole("button", { name: "Giao cho" })).toBeInTheDocument();
    expect(within(bare).getByRole("button", { name: "+ Hạn" })).toBeInTheDocument();
    expect(within(bare).queryByTitle("Thư ký UNI")).not.toBeInTheDocument();
    const live = screen.getByRole("checkbox", { name: "Gửi báo giá" }).closest("li")!;
    expect(within(live).getByTitle("Thư ký UNI")).toBeInTheDocument();
    expect(within(live).getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("opens the composer from a row's pencil and dismisses from its cross, asking the reason", async () => {
    renderRoom();
    const row = (await screen.findByRole("checkbox", { name: "Đặt phòng" })).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: 'Bỏ qua "Đặt phòng"' }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Lý do (không bắt buộc)" }), { target: { value: "Trùng" } });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ qua việc" }));
    await waitFor(() => expect(posts("/a1/dismiss")).toEqual([{ reason: "Trùng" }]));

    fireEvent.click(within(row).getByRole("button", { name: "Sửa & giao" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Tiêu đề issue" })).toHaveValue("Đặt phòng"));
  });

  it("opens Add item's composer from the end of the pending group", async () => {
    renderRoom();
    fireEvent.click(await screen.findByRole("button", { name: "Thêm việc" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Task sau họp")).toBeInTheDocument();
  });

  it("lists what was assigned with a tick, the person and a way to open the task", async () => {
    renderRoom();
    expect(await screen.findByRole("heading", { name: "Đã giao (1)" })).toBeInTheDocument();
    const open = screen.getByRole("link", { name: 'Mở việc "Báo khách hàng"' });
    expect(open).toHaveAttribute("href", expect.stringContaining("t9"));
    expect(screen.queryByText("In tài liệu")).not.toBeInTheDocument();
  });

  it("opens the composer of the item the feed asked to edit, once the list is in", async () => {
    const onEditHandled = vi.fn();
    renderRoom({ editItemId: "a0", onEditHandled });
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Tiêu đề issue" })).toHaveValue("Gửi biên bản"));
    expect(onEditHandled).toHaveBeenCalledTimes(1);
  });

  it("only clears an edit request for an item that is not pending", async () => {
    const onEditHandled = vi.fn();
    renderRoom({ editItemId: "a2", onEditHandled });
    await waitFor(() => expect(onEditHandled).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Review Focus 5: a participant without clerk rights reads the list, nothing more.
  it("gives a participant no ticks, no bar and no row commands", async () => {
    renderRoom({ canClerk: false });
    expect(await screen.findByText("Gửi biên bản")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/đã chọn/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Giao|Thêm việc|Sửa & giao|Bỏ qua "|\+ Hạn/ })).not.toBeInTheDocument();
  });
});
