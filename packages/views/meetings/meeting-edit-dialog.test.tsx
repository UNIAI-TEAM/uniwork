import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingEditDialog } from "./meeting-edit-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function localIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

const meeting: Meeting = {
  id: "m1",
  workspace_id: "w1",
  title: "Standup",
  description: "agenda",
  starts_at: localIso("2030-01-10", "09:00"),
  ends_at: localIso("2030-01-10", "09:30"),
  room_name: "uw_mtg_m1",
  created_by: "u-host",
  status: "SCHEDULED",
  timezone: "Asia/Ho_Chi_Minh",
};

beforeEach(() => {
  requestMock.mockReset();
  vi.mocked(toast.success).mockClear();
});

function openDialog(m: Meeting = meeting) {
  render(wrapWithNav(<MeetingEditDialog workspaceId="w1" meeting={m} trigger={<button type="button">Mở</button>} />));
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  return screen.getByRole("dialog");
}

describe("MeetingEditDialog", () => {
  it("confirms with a message, not the button label", async () => {
    requestMock.mockResolvedValue({ meeting });
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã lưu thay đổi"));
  });

  it("names hour and minute segments apart", () => {
    const dialog = openDialog();
    expect(within(dialog).getByLabelText("Giờ bắt đầu")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Phút bắt đầu")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Giờ kết thúc")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Phút kết thúc")).toBeInTheDocument();
  });

  it("flags an end at or before the start and holds Save", () => {
    const dialog = openDialog({ ...meeting, ends_at: localIso("2030-01-10", "08:30") });
    expect(within(dialog).getByText("Giờ kết thúc phải sau giờ bắt đầu.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Lưu thay đổi" })).toBeDisabled();
  });

  it("says why Save waits when the title is empty", () => {
    const dialog = openDialog();
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: " " } });
    expect(within(dialog).getByRole("button", { name: "Lưu thay đổi" })).toBeDisabled();
    expect(within(dialog).getByText("Nhập tiêu đề để tiếp tục")).toBeInTheDocument();
  });

  it("shows the pending label while saving", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Đang lưu…" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toBeDisabled();
  });
});
