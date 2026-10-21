import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderUploadReportDialog } from "./folder-upload-report-dialog";

const failures = [
  { path: "Báo cáo/2026/a.docx", code: "storage_quota_exceeded", retryable: false },
  { path: "Báo cáo/b.pdf", code: "some_future_code", retryable: true },
  { path: "Báo cáo/c.xlsx", retryable: true },
];
const FINAL_HINT = "Sửa tệp rồi tải lại thư mục.";
const EXPIRED_NOTE = "Lượt tải lên đã hết hạn nên không thử lại được. Hãy tải lại thư mục.";

function renderReport(over: Partial<Parameters<typeof FolderUploadReportDialog>[0]> = {}) {
  const onRetry = vi.fn();
  render(
    <FolderUploadReportDialog open onOpenChange={() => undefined} name="Báo cáo" failures={failures} onRetry={onRetry} {...over} />,
  );
  return { onRetry };
}

describe("FolderUploadReportDialog", () => {
  it("lists each failed path with the sentence of its code, and the generic one for a code it does not know", () => {
    renderReport();
    expect(screen.getByText("«Báo cáo»: 3 tệp bị lỗi. Các tệp còn lại đã được giữ nguyên.")).toBeInTheDocument();
    expect(screen.getByText("Báo cáo/2026/a.docx")).toBeInTheDocument();
    expect(screen.getByText("Đã hết dung lượng lưu trữ. Giải phóng dung lượng rồi tải lại thư mục.")).toBeInTheDocument();
    expect(screen.getAllByText("Không tải lên được tệp này.")).toHaveLength(2);
  });

  it("retries only on request", () => {
    const { onRetry } = renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại các tệp lỗi" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the retry button after the batch expired and says why", () => {
    renderReport({ canRetry: false, expired: true });
    expect(screen.queryByRole("button", { name: "Thử lại các tệp lỗi" })).toBeNull();
    expect(screen.getByText(EXPIRED_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(FINAL_HINT)).toBeNull();
  });

  it("offers no retry when nothing can be retried and says to fix the file, once", () => {
    renderReport({ canRetry: false, failures: [{ path: "Báo cáo/a.docx", code: "unsupported_media", retryable: false }] });
    expect(screen.queryByRole("button", { name: "Thử lại các tệp lỗi" })).toBeNull();
    expect(screen.getByText("Nội dung tệp không đúng định dạng. Sửa tệp rồi tải lại thư mục.")).toBeInTheDocument();
    // The file's own sentence already says what to do: the hint is not repeated under the list.
    expect(screen.queryByText(FINAL_HINT)).toBeNull();
    expect(screen.queryByText(EXPIRED_NOTE)).toBeNull();
  });

  it("gives a final failure whose sentence says nothing to do the one hint under the list", () => {
    renderReport({ canRetry: true, failures: [{ path: "Báo cáo/a.docx", code: "some_future_code", retryable: false }] });
    expect(screen.getByText("Không tải lên được tệp này.")).toBeInTheDocument();
    expect(screen.getAllByText(FINAL_HINT)).toHaveLength(1);
  });

  it("keeps the retry for the retryable files while the final ones carry their own hint", () => {
    renderReport({ canRetry: true });
    expect(screen.getByRole("button", { name: "Thử lại các tệp lỗi" })).toBeInTheDocument();
    expect(screen.queryByText(FINAL_HINT)).toBeNull();
  });

  it("reads the server's reason beside the code", () => {
    renderReport({ failures: [{ path: "Báo cáo/a.docx", code: "unsupported_media", reason: "zip_unreadable", retryable: false }] });
    expect(
      screen.getByText("Không đọc được tệp này, có thể tệp đã hỏng. Sửa tệp rồi tải lại thư mục."),
    ).toBeInTheDocument();
  });

  it("shows no hint when every failure can be retried", () => {
    renderReport({ canRetry: true, failures: [{ path: "Báo cáo/b.pdf", code: "network", retryable: true }] });
    expect(screen.queryByText(FINAL_HINT)).toBeNull();
  });
});
