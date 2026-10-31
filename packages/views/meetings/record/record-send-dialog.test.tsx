import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { RecordSendDialog } from "./record-send-dialog";

const MB = 1024 * 1024;

function renderDialog(over: Partial<ComponentProps<typeof RecordSendDialog>> = {}) {
  const props = {
    phase: "uploading" as const,
    percent: 58,
    sentBytes: 18 * MB,
    totalBytes: 31 * MB,
    seconds: 42 * 60 + 18,
    error: null,
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onLater: vi.fn(),
    ...over,
  };
  render(<RecordSendDialog {...props} />);
  return props;
}

beforeAll(() => {
  initI18n();
});

describe("RecordSendDialog", () => {
  it("shows the upload under way", () => {
    const props = renderDialog();
    expect(screen.getByRole("dialog", { name: "Đang gửi bản ghi" })).toBeInTheDocument();
    expect(screen.getByText("Gửi xong, Thư ký UNI bắt đầu ghi lời và soạn tóm tắt.")).toBeInTheDocument();
    expect(screen.getByText("Ghi âm tại phòng · 42:18")).toBeInTheDocument();
    expect(screen.getByText("18 MB / 31 MB")).toBeInTheDocument();
    expect(screen.getByText("58%")).toBeInTheDocument();
    expect(screen.getByText("Giữ trang này mở đến khi gửi xong.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đang gửi…" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Dừng gửi" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("waits for the network and sends again on demand", () => {
    const props = renderDialog({ phase: "waiting", error: new TypeError("Failed to fetch") });
    expect(screen.getByRole("dialog", { name: "Chờ mạng để gửi" })).toBeInTheDocument();
    expect(screen.getByText("Bản ghi an toàn trên máy này. Có mạng lại là tự gửi tiếp.")).toBeInTheDocument();
    expect(screen.getByText("Tạm dừng")).toHaveClass("text-warning");
    expect(screen.getByText("Mất mạng · tự gửi tiếp khi có mạng")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại ngay" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Để sau" }));
    expect(props.onLater).toHaveBeenCalledTimes(1);
  });

  it("words a refusal and offers no retry it cannot help", () => {
    const props = renderDialog({ phase: "failed", error: new ApiError("quota", "quota_exceeded", 402) });
    expect(screen.getByRole("alert")).toHaveTextContent("Tổ chức đã dùng hết số phút ghi lời của gói. Hỏi quản trị viên để nâng gói.");
    expect(screen.queryByRole("button", { name: "Thử lại ngay" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Để sau" }));
    expect(props.onLater).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the failure can pass", () => {
    const props = renderDialog({ phase: "failed", error: new ApiError("down", "internal", 503) });
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa tải xong tệp.");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại ngay" }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("mid-send, only the X or Dừng gửi stops it", () => {
    const props = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Đang gửi bản ghi" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(props.onStop).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Đang gửi bản ghi" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it("while waiting, Esc leaves it for later", () => {
    const props = renderDialog({ phase: "waiting", error: new TypeError("Failed to fetch") });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Chờ mạng để gửi" }), { key: "Escape" });
    expect(props.onLater).toHaveBeenCalledTimes(1);
  });
});
