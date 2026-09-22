import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import type { User } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { NewMeetingDialog } from "./new-meeting-dialog";

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

beforeEach(() => {
  requestMock.mockReset();
  setSessionUser(me);
});

function openDialog() {
  render(wrapWithNav(<NewMeetingDialog workspaceId="w1" trigger={<button type="button">Mở</button>} />));
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  return screen.getByRole("dialog");
}

describe("NewMeetingDialog", () => {
  it("names the primary action and says why it waits for a title", () => {
    requestMock.mockResolvedValue({ members: [] });
    const dialog = openDialog();
    const submit = within(dialog).getByRole("button", { name: "Tạo cuộc họp" });
    expect(submit).toBeDisabled();
    expect(within(dialog).getByText("Nhập tiêu đề để tiếp tục")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp tuần" } });
    expect(submit).toBeEnabled();
    expect(within(dialog).queryByText("Nhập tiêu đề để tiếp tục")).not.toBeInTheDocument();
  });

  it("shows the host and guest-link notes as text, not behind a tooltip", () => {
    requestMock.mockResolvedValue({ members: [] });
    const dialog = openDialog();
    expect(within(dialog).getByText("Bạn là chủ trì. Chọn thêm người tham dự.")).toBeInTheDocument();
    expect(
      within(dialog).getByText("Chỉ áp dụng thành viên workspace đã đăng nhập — không dùng cho khách bên ngoài."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Sau khi tạo cuộc họp, mở trang chi tiết để tạo liên kết cho khách bên ngoài."),
    ).toBeInTheDocument();
  });

  it("labels the time pickers as groups", () => {
    requestMock.mockResolvedValue({ members: [] });
    const dialog = openDialog();
    expect(within(dialog).getByRole("group", { name: "Bắt đầu" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Kết thúc" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Người tham dự" })).toBeInTheDocument();
  });

  it("seeds date and times from scheduleDefaults when opened", () => {
    requestMock.mockResolvedValue({ members: [] });
    render(
      wrapWithNav(
        <NewMeetingDialog
          workspaceId="w1"
          scheduleDefaults={{ date: "2026-09-22", start: "14:00", end: "15:00" }}
          trigger={<button type="button">Mở</button>}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Giờ bắt đầu")).toHaveValue("14");
    expect(within(dialog).getByLabelText("Phút bắt đầu")).toHaveValue("00");
    expect(within(dialog).getByLabelText("Giờ kết thúc")).toHaveValue("15");
    expect(within(dialog).getByLabelText("Phút kết thúc")).toHaveValue("00");
  });

  it("shows the pending label and holds Cancel while creating", async () => {
    requestMock.mockImplementation((path: unknown, init?: { method?: string }) => {
      if (init?.method === "POST") return new Promise(() => {});
      return Promise.resolve({ members: [] });
    });
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Họp tuần" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo cuộc họp" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Đang tạo…" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toBeDisabled();
  });
});
