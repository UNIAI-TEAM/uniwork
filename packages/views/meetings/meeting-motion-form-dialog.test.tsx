import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { MeetingMotion } from "@uniwork/core/types/meeting";
import { toast } from "sonner";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { MeetingMotionFormDialog } from "./meeting-motion-form-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const saved = {
  motion: {
    id: "mo1",
    title: "Thông qua kế hoạch",
    description: "",
    position: 1,
    ballot_mode: "PUBLIC",
    threshold: "MAJORITY",
    base: "PRESENT",
    status: "DRAFT",
    roll_size: null,
    total_members: null,
    cast_count: 0,
    result: null,
    voters: null,
    my_ballot: { on_roll: false, cast: false, choice: null },
  },
};
const onOpenChange = vi.fn();

beforeAll(() => {
  initI18n();
});
beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(saved);
  onOpenChange.mockReset();
  vi.mocked(toast.success).mockReset();
});

function renderForm(motion?: MeetingMotion) {
  render(wrapWithNav(<MeetingMotionFormDialog meetingId="m1" open onOpenChange={onOpenChange} motion={motion} />));
}

describe("MeetingMotionFormDialog", () => {
  it("creates an item with the common defaults and counts characters", async () => {
    renderForm();
    const submit = await screen.findByRole("button", { name: "Thêm" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("0/200")).toBeInTheDocument();
    expect(screen.getByText("0/2000")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Công khai" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Quá bán" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Trên số tham dự" })).toBeChecked();

    const title = "Thông qua kế hoạch quý IV";
    fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: title } });
    expect(screen.getByText(`${title.length}/200`)).toBeInTheDocument();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/motions", {
        method: "POST",
        body: { title, description: "", ballot_mode: "PUBLIC", threshold: "MAJORITY", base: "PRESENT" },
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Đã thêm nội dung biểu quyết");
  });

  it("says a secret ballot keeps only the totals", async () => {
    renderForm();
    expect(await screen.findByRole("radio", { name: /^Bỏ phiếu kín/ })).not.toBeChecked();
    expect(screen.getByText("Không lưu ai chọn gì, chỉ lưu số phiếu.")).toBeInTheDocument();
  });

  it("edits a draft in place with PATCH", async () => {
    renderForm({
      ...saved.motion,
      title: "Thông qua ngân sách",
      description: "Chi tiết",
      ballot_mode: "SECRET",
      threshold: "TWO_THIRDS",
      base: "ALL_MEMBERS",
    });
    expect(await screen.findByText("Sửa nội dung biểu quyết")).toBeInTheDocument();
    expect(screen.getByLabelText("Nội dung")).toHaveValue("Thông qua ngân sách");
    expect(screen.getByRole("radio", { name: /^Bỏ phiếu kín/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Hai phần ba" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Trên tổng thành viên" })).toBeChecked();

    fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: "  Thông qua ngân sách 2027 " } });
    fireEvent.click(screen.getByRole("radio", { name: "Công khai" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/meetings/m1/motions/mo1", {
        method: "PATCH",
        body: {
          title: "Thông qua ngân sách 2027",
          description: "Chi tiết",
          ballot_mode: "PUBLIC",
          threshold: "TWO_THIRDS",
          base: "ALL_MEMBERS",
        },
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Đã lưu nội dung biểu quyết"));
  });

  it("keeps the form open and shows why when the server refuses", async () => {
    requestMock.mockRejectedValue(new ApiError("chỉ sửa hoặc xóa được nội dung còn nháp", "motion_not_draft", 409));
    renderForm(saved.motion);
    fireEvent.click(await screen.findByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("chỉ sửa hoặc xóa được nội dung còn nháp");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
