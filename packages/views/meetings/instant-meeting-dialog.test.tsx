import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { ApiError } from "@uniwork/core/api/http";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { InstantMeetingDialog } from "./instant-meeting-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const me: User = {
  id: "u-host",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const members = [
  { workspace_id: "w1", user_id: "u-host", role: "owner", email: "me@x.com", display_name: "Me" },
  { workspace_id: "w1", user_id: "u-a", role: "member", email: "a@x.com", display_name: "An" },
  { workspace_id: "w1", user_id: "u-b", role: "member", email: "b@x.com", display_name: "Bình" },
];

const meeting = {
  id: "m9",
  workspace_id: "w1",
  title: "Họp nhanh",
  description: "",
  starts_at: "2026-09-22T09:00:00Z",
  ends_at: "2026-09-22T09:30:00Z",
  room_name: "uw_mtg_m9",
  created_by: "u-host",
  status: "IN_PROGRESS",
  scribe_enabled: true,
};

type Init = { method?: string; body?: Record<string, unknown>; headers?: Record<string, string> };

function serve(over: (path: string, init: Init) => unknown = () => undefined) {
  requestMock.mockImplementation((p: unknown, i?: Init) => {
    const path = String(p);
    const init = i ?? {};
    const own = over(path, init);
    if (own !== undefined) return own instanceof Promise ? own : Promise.resolve(own);
    if (path.endsWith("/members")) return Promise.resolve({ members });
    if (path.endsWith("/meeting-capabilities")) return Promise.resolve({ scribe: true, scribe_policy: "on" });
    if (path.endsWith("/meetings/instant")) return Promise.resolve({ meeting });
    if (path.endsWith("/scribe")) return Promise.resolve({ meeting: { ...meeting, scribe_enabled: false } });
    if (path.endsWith("/invitations")) return Promise.resolve({ participant: null });
    return Promise.resolve({});
  });
}

const calls = (suffix: string) => requestMock.mock.calls.filter((c) => String(c[0]).endsWith(suffix));

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
  setSessionUser(me);
  serve();
});

function renderDialog(onStarted = vi.fn(), client?: QueryClient) {
  render(
    wrapWithNav(
      <InstantMeetingDialog workspaceId="w1" onStarted={onStarted} trigger={<button type="button">Mở</button>} />,
      undefined,
      client,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  return screen.getByRole("dialog", { name: "Họp ngay" });
}

async function pick(dialog: HTMLElement, name: string) {
  const search = within(dialog).getByRole("combobox", { name: "Người tham dự" });
  fireEvent.change(search, { target: { value: name } });
  await within(dialog).findByRole("option", { name });
  fireEvent.keyDown(search, { key: "Enter" });
}

describe("InstantMeetingDialog", () => {
  it("opens on the title, says what an empty one becomes and counts the host", async () => {
    const dialog = renderDialog();
    const title = within(dialog).getByLabelText("Tiêu đề nhanh");
    expect(title).toHaveFocus();
    expect(title).toHaveAttribute("placeholder", "Cuộc họp tức thì");
    expect(within(dialog).getByText("Không bắt buộc. Để trống sẽ là “Cuộc họp tức thì”.")).toBeInTheDocument();
    expect(within(dialog).getByText("1 người · gồm bạn")).toBeInTheDocument();
    await pick(dialog, "An");
    expect(within(dialog).getByText("2 người · gồm bạn")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Bỏ An" })).toBeInTheDocument();
  });

  it("never lets a plain Enter in the people search submit the form", () => {
    const dialog = renderDialog();
    const search = within(dialog).getByRole("combobox", { name: "Người tham dự" });
    fireEvent.change(search, { target: { value: "zzz" } });
    // fireEvent returns false when the default (implicit form submit) was prevented.
    expect(fireEvent.keyDown(search, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(within(dialog).getByLabelText("Tiêu đề nhanh"), { key: "Enter" })).toBe(true);
  });

  it("starts from a clean form after being closed", async () => {
    const dialog = renderDialog();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề nhanh"), { target: { value: "Sửa lỗi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Tiêu đề nhanh")).toHaveValue("");
  });

  it("shows the pending label while starting and ignores a second press", async () => {
    serve((path) => (path.endsWith("/meetings/instant") ? new Promise(() => {}) : undefined));
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    const busy = await within(dialog).findByRole("button", { name: "Đang bắt đầu…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(busy);
    expect(calls("/meetings/instant")).toHaveLength(1);
  });

  it("names who was not invited and offers Mời lại", async () => {
    const onStarted = vi.fn();
    serve((path, init) =>
      path.endsWith("/invitations") && init.body?.user_id === "u-b" ? Promise.reject(new ApiError("không mời được", "forbidden", 403)) : undefined,
    );
    const dialog = renderDialog(onStarted);
    await pick(dialog, "An");
    await pick(dialog, "Bình");
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("m9"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Chưa mời được: Bình.",
        expect.objectContaining({ duration: Infinity, action: expect.objectContaining({ label: "Mời lại" }) }),
      ),
    );
    const before = calls("/invitations").length;
    (vi.mocked(toast.error).mock.calls[0]![1] as unknown as { action: { onClick: () => void } }).action.onClick();
    await waitFor(() => expect(calls("/invitations")).toHaveLength(before + 1));
    expect((calls("/invitations").at(-1)![1] as Init).body).toEqual({ user_id: "u-b" });
  });

  it("keeps the dialog with a line when the room does not open, and retries with the same key", async () => {
    const onStarted = vi.fn();
    serve((path) => (path.endsWith("/meetings/instant") ? Promise.reject(new ApiError("hỏng", "internal", 500)) : undefined));
    const dialog = renderDialog(onStarted);
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề nhanh"), { target: { value: "Sự cố POS" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/^Chưa mở được phòng họp\./);
    expect(within(dialog).getByLabelText("Tiêu đề nhanh")).toHaveValue("Sự cố POS");
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    await waitFor(() => expect(calls("/meetings/instant")).toHaveLength(2));
    const keys = calls("/meetings/instant").map((c) => (c[1] as Init).headers?.["Idempotency-Key"]);
    expect(keys[0]).toEqual(expect.any(String));
    expect(keys[1]).toBe(keys[0]);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("says the first meeting may already be running when the same key comes back with another title", async () => {
    serve((path) =>
      path.endsWith("/meetings/instant") ? Promise.reject(new ApiError("không khớp", "idempotency_payload_mismatch", 409)) : undefined,
    );
    const dialog = renderDialog(vi.fn());
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/^Cuộc họp với thông tin trước có thể đã được tạo\./);
  });

  it("refreshes the meeting list, the stats and the calendar once the room opens", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onStarted = vi.fn();
    const dialog = renderDialog(onStarted, client);
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("m9"));
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([JSON.stringify(["meetings", "w1"]), JSON.stringify(["meeting-stats", "w1"]), JSON.stringify(["calendar", "w1"])]),
    );
  });

  it("turns the scribe off before opening the room when the person switched it off", async () => {
    const order: string[] = [];
    const onStarted = vi.fn(() => order.push("room"));
    serve((path) => {
      if (path.endsWith("/scribe")) {
        order.push("scribe");
        return { meeting: { ...meeting, scribe_enabled: false } };
      }
      return undefined;
    });
    const dialog = renderDialog(onStarted);
    const toggle = await within(dialog).findByRole("switch", { name: "Thư ký UNI" });
    fireEvent.click(toggle);
    expect(within(dialog).getByText("Bạn đã đổi · Thư ký UNI sẽ rời phòng ngay khi phòng mở.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("m9"));
    expect(order).toEqual(["scribe", "room"]);
    expect((calls("/scribe")[0]![1] as Init).body).toEqual({ enabled: false });
  });
});
