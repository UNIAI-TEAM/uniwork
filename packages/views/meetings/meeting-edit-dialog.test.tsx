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

  it("flags an end equal to the start on the field and keeps focus there on Save", () => {
    const dialog = openDialog({ ...meeting, ends_at: meeting.starts_at });
    const error = within(dialog).getByText("Giờ kết thúc phải khác giờ bắt đầu.");
    const save = within(dialog).getByRole("button", { name: "Lưu thay đổi" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(requestMock).not.toHaveBeenCalledWith(expect.stringContaining("/meetings/m1"), expect.anything());
    expect(within(dialog).getByRole("group", { name: "Kết thúc" })).toHaveAttribute("aria-describedby", error.id);
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Giờ kết thúc"));
  });

  it("puts the title error under the title and focuses it on Save", () => {
    const dialog = openDialog();
    const input = within(dialog).getByLabelText("Tiêu đề");
    fireEvent.change(input, { target: { value: " " } });
    const save = within(dialog).getByRole("button", { name: "Lưu thay đổi" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    const error = within(dialog).getByText("Nhập tiêu đề để tiếp tục");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
    expect(document.activeElement).toBe(input);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("types and saves times in the meeting's zone, not the browser's", async () => {
    requestMock.mockResolvedValue({ meeting });
    // 00:00Z is 09:00 in Tokyo.
    const tokyo: Meeting = {
      ...meeting,
      timezone: "Asia/Tokyo",
      starts_at: "2030-01-10T00:00:00.000Z",
      ends_at: "2030-01-10T00:30:00.000Z",
    };
    const dialog = openDialog(tokyo);
    expect(within(dialog).getByLabelText("Giờ bắt đầu")).toHaveValue("09");
    expect(within(dialog).getByLabelText("Giờ kết thúc")).toHaveValue("09");
    expect(within(dialog).getByRole("combobox", { name: "Múi giờ" })).toHaveTextContent("GMT+9 · Tokyo");
    fireEvent.keyDown(within(dialog).getByLabelText("Giờ kết thúc"), { key: "ArrowUp" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/meetings/m1",
        expect.objectContaining({
          body: expect.objectContaining({
            starts_at: "2030-01-10T00:00:00.000Z",
            ends_at: "2030-01-10T01:30:00.000Z",
            timezone: "Asia/Tokyo",
          }),
        }),
      ),
    );
  });

  it("flags a moved start that already passed, but not an untouched one", () => {
    const past: Meeting = {
      ...meeting,
      status: "SCHEDULED",
      starts_at: "2020-01-10T02:00:00.000Z",
      ends_at: "2020-01-10T02:30:00.000Z",
    };
    const dialog = openDialog(past);
    expect(within(dialog).queryByText("Giờ bắt đầu đã qua.")).not.toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByLabelText("Phút bắt đầu"), { key: "ArrowUp" });
    expect(within(dialog).getByText("Giờ bắt đầu đã qua.")).toBeInTheDocument();
  });

  it("keeps the draft when the meeting changes elsewhere, and offers to reload", () => {
    const { rerender } = render(
      wrapWithNav(<MeetingEditDialog workspaceId="w1" meeting={{ ...meeting, version: 1 }} trigger={<button type="button">Mở</button>} />),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tiêu đề"), { target: { value: "Đang gõ" } });
    rerender(
      wrapWithNav(
        <MeetingEditDialog
          workspaceId="w1"
          meeting={{ ...meeting, title: "Đổi ở nơi khác", version: 2 }}
          trigger={<button type="button">Mở</button>}
        />,
      ),
    );
    expect(within(dialog).getByLabelText("Tiêu đề")).toHaveValue("Đang gõ");
    expect(within(dialog).getByText("Cuộc họp vừa được cập nhật ở nơi khác.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tải lại" }));
    expect(within(dialog).getByLabelText("Tiêu đề")).toHaveValue("Đổi ở nơi khác");
    expect(within(dialog).queryByText("Cuộc họp vừa được cập nhật ở nơi khác.")).not.toBeInTheDocument();
  });

  it("shows the pending label while saving", async () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Đang lưu…" })).toBeDisabled());
    expect(within(dialog).getByRole("button", { name: "Hủy" })).toBeDisabled();
  });
});
