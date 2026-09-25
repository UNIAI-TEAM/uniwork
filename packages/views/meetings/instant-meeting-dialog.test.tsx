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
};

const HINT = "Không bắt buộc. Có thể mời người ngay hoặc sau khi vào phòng.";

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
  setSessionUser(me);
});

function renderDialog(onStarted = vi.fn()) {
  render(
    wrapWithNav(
      <InstantMeetingDialog workspaceId="w1" onStarted={onStarted} trigger={<button type="button">Mở</button>} />,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  return screen.getByRole("dialog");
}

describe("InstantMeetingDialog", () => {
  it("says the hint once", () => {
    requestMock.mockResolvedValue({ members });
    const dialog = renderDialog();
    expect(within(dialog).getAllByText(HINT)).toHaveLength(1);
  });

  it("starts from a clean form after being closed", async () => {
    requestMock.mockResolvedValue({ members });
    const dialog = renderDialog();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề nhanh"), { target: { value: "Sửa lỗi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Tiêu đề nhanh")).toHaveValue("");
  });

  it("shows the pending label while starting", async () => {
    requestMock.mockImplementation((_path: unknown, init?: { method?: string }) => {
      if (init?.method === "POST") return new Promise(() => {});
      return Promise.resolve({ members });
    });
    const dialog = renderDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Đang bắt đầu…" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toBeDisabled();
  });

  it("names how many invitations did not go out", async () => {
    const onStarted = vi.fn();
    requestMock.mockImplementation((path: unknown, init?: { method?: string; body?: { user_id?: string } }) => {
      const p = String(path);
      if (p.endsWith("/meetings/instant")) return Promise.resolve({ meeting });
      if (p.endsWith("/invitations")) {
        if (init?.body?.user_id === "u-b") return Promise.reject(new ApiError("không mời được", "forbidden", 403));
        return Promise.resolve({ participant: null });
      }
      return Promise.resolve({ members });
    });
    const dialog = renderDialog(onStarted);
    fireEvent.click(await within(dialog).findByText("An"));
    fireEvent.click(within(dialog).getByText("Bình"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Họp ngay" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("m9"));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Chưa mời được 1 người. Mời lại trong trang cuộc họp.",
      ),
    );
  });
});
