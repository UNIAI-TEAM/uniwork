import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import type { Meeting, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingSheet } from "./meeting-sheet";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const me: User = {
  id: "u-lan",
  email: "lan@x.com",
  display_name: "Lan Phạm",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = { id: "w1", slug: "van-hanh", name: "Vận hành", organization_id: "o1", organization_slug: "sm", organization_name: "Sao Mai" };
const members = [
  { workspace_id: "w1", user_id: "u-lan", role: "owner", email: "lan@x.com", display_name: "Lan Phạm" },
  { workspace_id: "w1", user_id: "u-ha", role: "member", email: "ha@x.com", display_name: "Hà Vũ" },
  { workspace_id: "w1", user_id: "u-minh", role: "member", email: "minh@x.com", display_name: "Minh Trần" },
];
const DRAFT = { date: "2030-01-10", start: "09:00", end: "09:30", timezone: "Asia/Ho_Chi_Minh" };
const meeting = {
  id: "m3",
  workspace_id: "w1",
  title: "Duyệt kịch bản",
  description: "Cùng agency",
  starts_at: "2030-01-10T02:00:00Z",
  ends_at: "2030-01-10T03:00:00Z",
  room_name: "r",
  created_by: "u-lan",
  status: "SCHEDULED",
  host_user_id: "u-lan",
  timezone: "Asia/Ho_Chi_Minh",
  version: 1,
} as Meeting;

type Init = { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> };
type Route = (path: string, init: Init) => unknown;

function serve(extra: Route = () => undefined) {
  requestMock.mockImplementation((p: unknown, i?: Init) => {
    const path = String(p);
    const init = i ?? {};
    const own = extra(path, init);
    if (own !== undefined) return own instanceof Promise ? own : Promise.resolve(own);
    if (path.endsWith("/members")) return Promise.resolve({ members });
    if (path.endsWith("/meeting-capabilities")) return Promise.resolve({ scribe: true, scribe_policy: "on" });
    if (path === "/api/v1/workspaces/w1/meetings" && init.method === "POST") return Promise.resolve({ meeting: { ...meeting, id: "new1", scribe_enabled: true } });
    if (path.endsWith("/invitations") && init.method === "POST") {
      return Promise.resolve({ participant: { id: `p-${String(init.body?.user_id)}`, meeting_id: "new1", principal_type: "USER", role: "ATTENDEE", status: "ACTIVE" } });
    }
    if (path.endsWith("/participants")) return Promise.resolve({ participants: [] });
    if (path.endsWith("/motions")) return Promise.resolve({ motions: [] });
    return Promise.resolve({});
  });
}

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

function openCreate(onDone = vi.fn()) {
  render(shell(<MeetingSheet mode="create" workspaceId="w1" initialDraft={DRAFT} onDone={onDone} trigger={<button type="button">Mở</button>} />));
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  return screen.getByRole("dialog");
}

function posts(suffix: string) {
  return requestMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix) && (c[1] as Init | undefined)?.method === "POST");
}

async function pickPerson(dialog: HTMLElement, name: string) {
  const search = within(dialog).getByRole("combobox");
  fireEvent.change(search, { target: { value: name } });
  await within(dialog).findByRole("option", { name });
  fireEvent.keyDown(search, { key: "Enter" });
}

beforeEach(() => {
  requestMock.mockReset();
  for (const fn of [toast.success, toast.error, toast.warning]) vi.mocked(fn).mockClear();
  setSessionUser(me);
  serve();
});

describe("MeetingSheet · create", () => {
  it("opens every member on focus, ticks several without typing and unticks on a second click", async () => {
    const dialog = openCreate();
    const search = within(dialog).getByRole("combobox");
    fireEvent.focus(search);
    const list = await within(dialog).findByRole("listbox");
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    // The host is not offered: they are in the meeting already.
    expect((await within(list).findAllByRole("option")).map((o) => o.textContent)).toEqual(["HVHà Vũ", "MTMinh Trần"]);
    fireEvent.click(within(list).getByRole("option", { name: "Hà Vũ" }));
    fireEvent.click(within(list).getByRole("option", { name: "Minh Trần" }));
    expect(within(dialog).getByRole("listbox")).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: "Hà Vũ" })).toHaveAttribute("aria-selected", "true");
    expect(within(list).getByRole("option", { name: "Minh Trần" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("3 người · gồm bạn")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("option", { name: "Hà Vũ" }));
    expect(within(list).getByRole("option", { name: "Hà Vũ" })).toHaveAttribute("aria-selected", "false");
    expect(within(dialog).getByText("2 người · gồm bạn")).toBeInTheDocument();
  });

  it("opens on the title and keeps the e2e contract", async () => {
    const dialog = openCreate();
    const title = within(dialog).getByLabelText("Tiêu đề");
    await waitFor(() => expect(title).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Tạo cuộc họp" })).toBeInTheDocument();
    expect(within(dialog).getAllByText("Chọn người để mời").length).toBeGreaterThan(0);
  });

  it("does not focus the title on a phone, so the keyboard stays down", async () => {
    const width = window.innerWidth;
    window.innerWidth = 390;
    try {
      const dialog = openCreate();
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(within(dialog).getByLabelText("Tiêu đề")).not.toHaveFocus();
    } finally {
      window.innerWidth = width;
    }
  });

  it("creates with no attendees, then invites each person, and opens the meeting", async () => {
    const onDone = vi.fn();
    const dialog = openCreate(onDone);
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Duyệt kịch bản" } });
    await pickPerson(dialog, "Hà Vũ");
    expect(within(dialog).getAllByText("Hà Vũ sẽ nhận lời mời").length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("new1"));
    const create = posts("/workspaces/w1/meetings")[0]![1] as Init;
    expect(create.body).toMatchObject({ title: "Duyệt kịch bản", attendee_user_ids: [], timezone: "Asia/Ho_Chi_Minh" });
    expect(create.headers?.["Idempotency-Key"]).toBeTruthy();
    expect(posts("/meetings/new1/invitations").map((c) => (c[1] as Init).body)).toEqual([{ user_id: "u-ha" }]);
    expect(toast.success).toHaveBeenCalledWith("Đã tạo cuộc họp", expect.anything());
  });

  it("offers the optional parts as chips: one opens its part, an empty part closes back to its chip", async () => {
    const dialog = openCreate();
    const chips = within(dialog).getByRole("group", { name: "Thêm tùy chọn" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Khách bên ngoài", "Biểu quyết", "Điểm danh"]);
    fireEvent.click(within(chips).getByRole("button", { name: "Điểm danh" }));
    expect(within(dialog).getByLabelText("Tỉ lệ có mặt tối thiểu (%)")).toHaveFocus();
    expect(within(chips).queryByRole("button", { name: "Điểm danh" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Bỏ Điểm danh" }));
    expect(within(dialog).queryByLabelText("Tỉ lệ có mặt tối thiểu (%)")).toBeNull();
    fireEvent.click(within(chips).getByRole("button", { name: "Biểu quyết" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Nội dung")).toHaveFocus());
    fireEvent.click(within(dialog).getByRole("button", { name: "Bỏ Biểu quyết" }));
    expect(within(chips).getAllByRole("button")).toHaveLength(3);
  });

  it("says who reads the scribe's notes on one chip and changes it from its menu", async () => {
    const dialog = openCreate();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Ai xem được tóm tắt và lời thoại: Người dự họp, đổi" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /^Cả workspace/ }));
    expect(await within(dialog).findByRole("button", { name: "Ai xem được tóm tắt và lời thoại: Cả workspace, đổi" })).toBeInTheDocument();
  });

  it("says what Thư ký UNI does behind the ? beside its name", async () => {
    const dialog = openCreate();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Thư ký UNI làm gì?" }));
    expect(await screen.findByText("Hiện phụ đề trực tiếp cho mọi người trong phòng.")).toBeInTheDocument();
    expect(screen.getByText("Tóm tắt cuộc họp và gợi ý việc cần làm từ những gì đã nói.")).toBeInTheDocument();
  });

  it("puts the title error on the field and sends nothing", async () => {
    const dialog = openCreate();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(await within(dialog).findByText("Nhập tiêu đề để tiếp tục")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByLabelText("Tiêu đề")).toHaveFocus());
    expect(posts("/meetings")).toHaveLength(0);
  });

  it("submits on ⌘↵ but never mid-composition", async () => {
    const dialog = openCreate();
    const title = within(dialog).getByLabelText("Tiêu đề");
    fireEvent.change(title, { target: { value: "Họp" } });
    fireEvent.keyDown(title, { key: "Enter", metaKey: true, isComposing: true });
    expect(posts("/workspaces/w1/meetings")).toHaveLength(0);
    fireEvent.keyDown(title, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(posts("/workspaces/w1/meetings")).toHaveLength(1));
  });

  it("asks before discarding a typed draft", async () => {
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Nháp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Bỏ cuộc họp đang soạn?")).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Bỏ bản soạn" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows a failed guest link in the result panel and retries it", async () => {
    let fail = true;
    serve((path, init) => {
      if (path.endsWith("/invite-links") && init.method === "POST") {
        if (fail) return Promise.reject(new TypeError("Failed to fetch"));
        return { invite_link: { id: "l1", meeting_id: "new1", name: "Agency", access_mode: "REQUEST_APPROVAL", expires_at: "2030-01-20T00:00:00Z", used_count: 0, secret: "s3" } };
      }
      return undefined;
    });
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Duyệt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Khách bên ngoài" }));
    fireEvent.change(within(dialog).getByLabelText("Tên liên kết"), { target: { value: "Agency" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(await screen.findByText("Chưa tạo được liên kết khách “Agency”.")).toBeInTheDocument();
    expect(screen.getByText("Mất kết nối. Kiểm tra mạng rồi thử lại.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("button", { name: "Sao chép liên kết" })).toBeInTheDocument();
    expect(screen.getByText("Hãy sao chép ngay. Mã bí mật chỉ hiện một lần.")).toBeInTheDocument();
  });
});

describe("MeetingSheet · create runs", () => {
  const isCreate = (path: string, init: Init) => path === "/api/v1/workspaces/w1/meetings" && init.method === "POST";
  const sent = () => posts("/workspaces/w1/meetings").map((c) => c[1] as Init);

  it("sends the edited draft after a refused create, under the same key", async () => {
    let n = 0;
    serve((path, init) => (isCreate(path, init) && n++ === 0 ? Promise.reject(new ApiError("dự án không còn", "not_found", 404)) : undefined));
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(await within(dialog).findByText(/^Chưa tạo được cuộc họp\./)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp B" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()[1]!.body).toMatchObject({ title: "Họp B" });
    expect(sent()[1]!.headers?.["Idempotency-Key"]).toBe(sent()[0]!.headers?.["Idempotency-Key"]);
  });

  it("says a meeting may exist when a lost create is sent again with other details", async () => {
    let n = 0;
    serve((path, init) => {
      if (!isCreate(path, init)) return undefined;
      return Promise.reject(n++ === 0 ? new TypeError("Failed to fetch") : new ApiError("khác", "idempotency_payload_mismatch", 409));
    });
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(await within(dialog).findByText(/^Không rõ cuộc họp đã được tạo chưa/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp B" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    expect(await within(dialog).findByText("Cuộc họp với thông tin trước có thể đã được tạo. Hãy xem danh sách cuộc họp trước khi tạo lại.")).toBeInTheDocument();
    expect(sent()[1]!.body).toMatchObject({ title: "Họp B" });
  });

  it("creates under the quick card's key when it hands one over", async () => {
    render(shell(<MeetingSheet mode="create" workspaceId="w1" initialDraft={DRAFT} idempotencyKey="k-card" trigger={<button type="button">Mở</button>} />));
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]!.headers?.["Idempotency-Key"]).toBe("k-card");
  });

  it("asks before discarding what the quick card handed over, not the slot's time alone", async () => {
    const draft = { ...DRAFT, title: "Duyệt", people: [{ userId: "u-ha", role: "MEMBER" as const }] };
    const ui = (d: typeof DRAFT) => shell(<MeetingSheet mode="create" workspaceId="w1" initialDraft={d} trigger={<button type="button">Mở</button>} />);
    const view = render(ui(DRAFT));
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    view.unmount();
    render(ui(draft));
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hủy" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("keeps the result panel, with its retrying row, while a retry runs", async () => {
    let answer: ((v: unknown) => void) | null = null;
    serve((path, init) => {
      if (!(path.endsWith("/invite-links") && init.method === "POST")) return undefined;
      if (!answer) {
        answer = () => {};
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return new Promise((resolve) => (answer = resolve));
    });
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Duyệt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Khách bên ngoài" }));
    fireEvent.change(within(dialog).getByLabelText("Tên liên kết"), { target: { value: "Agency" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Đang thử lại…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Tiêu đề")).toBeNull();
    act(() => answer!({ invite_link: { id: "l1", meeting_id: "new1", name: "Agency", access_mode: "REQUEST_APPROVAL", expires_at: "2030-01-20T00:00:00Z", used_count: 0, secret: "s3" } }));
    expect(await screen.findByRole("button", { name: "Sao chép liên kết" })).toBeInTheDocument();
  });

  it("reports by toast when the sheet goes away during phase 2", async () => {
    let refuse: ((e: unknown) => void) | null = null;
    serve((path, init) => (path.endsWith("/invitations") && init.method === "POST" ? new Promise((_, reject) => (refuse = reject)) : undefined));
    const view = render(shell(<MeetingSheet mode="create" workspaceId="w1" initialDraft={DRAFT} trigger={<button type="button">Mở</button>} />));
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp" } });
    await pickPerson(dialog, "Hà Vũ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() => expect(refuse).not.toBeNull());
    view.unmount();
    refuse!(new ApiError("không mời được", "forbidden", 403));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
  });

  it("reports a retry on the panel reopened from the toast, not by another toast", async () => {
    let refuse: ((e: unknown) => void) | null = null;
    serve((path, init) => {
      if (!(path.endsWith("/invitations") && init.method === "POST")) return undefined;
      if (refuse) return Promise.reject(new ApiError("không mời được", "forbidden", 403));
      return new Promise((_, reject) => (refuse = reject));
    });
    const dialog = openCreate();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp" } });
    await pickPerson(dialog, "Hà Vũ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() => expect(refuse).not.toBeNull());
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    refuse!(new ApiError("không mời được", "forbidden", 403));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    const action = vi.mocked(toast.warning).mock.calls[0]![1]?.action as unknown as { onClick: () => void };
    act(() => action.onClick());
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("opens the meeting from the panel's primary while a retry still runs", async () => {
    let calls = 0;
    serve((path, init) => {
      if (!(path.endsWith("/invitations") && init.method === "POST")) return undefined;
      return calls++ === 0 ? Promise.reject(new ApiError("không mời được", "forbidden", 403)) : new Promise(() => {});
    });
    const onDone = vi.fn();
    const dialog = openCreate(onDone);
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp" } });
    await pickPerson(dialog, "Hà Vũ");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Đang thử lại…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở cuộc họp" }));
    expect(onDone).toHaveBeenCalledWith("new1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("holds the panel's primary, like ×, while a guest link's retry is in flight", async () => {
    let calls = 0;
    serve((path, init) => {
      if (!(path.endsWith("/invite-links") && init.method === "POST")) return undefined;
      return calls++ === 0 ? Promise.reject(new TypeError("Failed to fetch")) : new Promise(() => {});
    });
    const onDone = vi.fn();
    const dialog = openCreate(onDone);
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Duyệt" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Khách bên ngoài" }));
    fireEvent.change(within(dialog).getByLabelText("Tên liên kết"), { target: { value: "Agency" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Đang thử lại…")).toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "Mở cuộc họp" });
    expect(primary).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(primary);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("MeetingSheet · edit", () => {
  function openEdit(m: Meeting = meeting, extra?: Route) {
    serve(extra);
    const ui = (x: Meeting) => shell(<MeetingSheet mode="edit" workspaceId="w1" meeting={x} trigger={<button type="button">Sửa</button>} />);
    const view = render(ui(m));
    fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
    return { rerender: (x: Meeting) => view.rerender(ui(x)) };
  }

  it("counts the changes and PATCHes only them", async () => {
    openEdit();
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Chưa có thay đổi")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Duyệt kịch bản mới" } });
    expect(within(dialog).getByText("1 thay đổi")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã lưu thay đổi", expect.anything()));
    const patch = requestMock.mock.calls.find((c) => String(c[0]) === "/api/v1/meetings/m3" && (c[1] as Init)?.method === "PATCH");
    expect((patch![1] as Init).body).toEqual({ title: "Duyệt kịch bản mới" });
  });

  it("locks the time of a live meeting and the quorum of a finalized roll", async () => {
    openEdit({ ...meeting, status: "IN_PROGRESS" }, (path) =>
      path.endsWith("/attendance") ? { finalized_at: "2030-01-10T02:30:00Z", summary: { members: 1, present: 1, late: 0, excused: 0, absent: 0 }, rows: [] } : undefined,
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Cuộc họp đang diễn ra — không thể đổi thời gian.")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Giờ bắt đầu")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Điểm danh" }));
    expect(await within(dialog).findByText("Điểm danh đã chốt. Mở lại điểm danh rồi thử lại.")).toBeInTheDocument();
  });

  it("counts only live guest links, never a revoked one", async () => {
    const link = { meeting_id: "m3", name: "Agency", access_mode: "REQUEST_APPROVAL", expires_at: "2030-01-09T00:00:00Z", max_uses: 5, used_count: 0, created_at: "2026-10-23T07:13:04Z" };
    openEdit(meeting, (path, init) =>
      path.endsWith("/invite-links") && init.method !== "POST"
        ? { invite_links: [{ ...link, id: "l-new" }, { ...link, id: "l-old", revoked_at: "2026-10-24T15:26:48Z" }] }
        : undefined,
    );
    const dialog = await screen.findByRole("dialog");
    const guests = await within(dialog).findByRole("region", { name: "Khách bên ngoài" });
    expect(within(guests).getAllByText("Agency")).toHaveLength(1);
    expect(within(guests).getByText("1")).toBeInTheDocument();
  });

  it("never offers back someone removed from the meeting earlier", async () => {
    openEdit(meeting, (path) =>
      path.endsWith("/participants")
        ? { participants: [{ id: "p9", meeting_id: "m3", principal_type: "USER", user_id: "u-minh", role: "ATTENDEE", status: "REMOVED" }] }
        : undefined,
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Thêm người" }));
    const search = within(dialog).getByRole("combobox");
    fireEvent.change(search, { target: { value: "Minh" } });
    expect(await within(dialog).findByText("Không có ai khớp với tìm kiếm.")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "Hà" } });
    expect(await within(dialog).findByRole("option", { name: "Hà Vũ" })).toBeInTheDocument();
  });

  it("offers a reload when someone else saved, without overwriting the draft", async () => {
    const { rerender } = openEdit();
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Chưa có thay đổi");
    act(() => rerender({ ...meeting, version: 2, title: "Tên khác" }));
    expect(await within(dialog).findByText("Cuộc họp vừa được cập nhật ở nơi khác.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Tiêu đề")).toHaveValue("Duyệt kịch bản");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tải lại" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Tiêu đề")).toHaveValue("Tên khác"));
  });
});

describe("MeetingSheet · follow-up", () => {
  it("moves the week on, leaves the agenda empty and sends the series link", async () => {
    const previous = {
      ...meeting,
      id: "m1",
      status: "ENDED",
      title: "Giao ban tuần 43 — Ra mắt",
      description: "Họp giao ban hằng tuần",
      starts_at: "2026-10-22T02:00:00Z",
      ends_at: "2026-10-22T02:28:00Z",
    } as Meeting;
    const participants = [
      { id: "p1", meeting_id: "m1", principal_type: "USER", user_id: "u-lan", role: "HOST", status: "ACTIVE" },
      { id: "p2", meeting_id: "m1", principal_type: "USER", user_id: "u-ha", role: "ATTENDEE", status: "ACTIVE", is_secretary: true },
    ];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T14:18:00Z"));
    try {
      render(shell(<MeetingSheet mode="followUp" workspaceId="w1" previous={previous} previousParticipants={participants} trigger={<button type="button">Tiếp</button>} />));
      fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText("Lên lịch họp tiếp theo")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Tiêu đề")).toHaveValue("Giao ban tuần 44 — Ra mắt");
      expect(within(dialog).getByLabelText("Nội dung dự kiến")).toHaveValue("");
      expect(await within(dialog).findByRole("button", { name: "Giao lại vai thư ký" })).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Dùng lại" }));
      expect(within(dialog).getByLabelText("Nội dung dự kiến")).toHaveValue("Họp giao ban hằng tuần");
      fireEvent.click(within(dialog).getByRole("button", { name: "Lên lịch họp" }));
      await waitFor(() => expect(posts("/workspaces/w1/meetings")).toHaveLength(1));
      expect((posts("/workspaces/w1/meetings")[0]![1] as Init).body).toMatchObject({
        previous_meeting_id: "m1",
        starts_at: "2026-10-29T02:00:00.000Z",
        ends_at: "2026-10-29T02:30:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PhonePeoplePicker", () => {
  it("toggles people, counts them and closes on Xong or Esc", async () => {
    const { PhonePeoplePicker } = await import("./phone-picker");
    const onToggle = vi.fn();
    const onClose = vi.fn();
    render(
      wrapWithNav(
        <PhonePeoplePicker members={members as never} hostId="u-lan" chosen={new Set(["u-ha"])} onToggle={onToggle} onClose={onClose} />,
      ),
    );
    expect(screen.getByRole("checkbox", { name: "Hà Vũ" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("checkbox", { name: "Lan Phạm" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tìm thành viên"), { target: { value: "minh" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Minh Trần" }));
    expect(onToggle).toHaveBeenCalledWith("u-minh");
    expect(screen.getByText("Đã chọn 1 người")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Tìm thành viên"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Xong" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
