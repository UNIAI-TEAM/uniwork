import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfImageEditPanel } from "./image-edit-panel";
import { MAX_PDF_IMAGE_BYTES } from "./provider";
import type { PdfImageOperationProvider, PdfImageSelection } from "./types";

const selection: PdfImageSelection = { page: 2, objectId: "image-1", rect: [10, 20, 100, 140], layer: "aboveText" };
function provider(): PdfImageOperationProvider { return { insertImage: vi.fn(), transformImage: vi.fn(), replaceImage: vi.fn(), deleteImage: vi.fn() }; }
function chooseFile(file: File): void { fireEvent.change(screen.getByLabelText("Thay tệp ảnh"), { target: { files: [file] } }); }

describe("PdfImageEditPanel", () => {
  it("submits move, resize and rotate through transformImage", async () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Phải" }), { target: { value: "120" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Góc xoay" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng thay đổi ảnh" }));
    await waitFor(() => expect(host.transformImage).toHaveBeenCalledWith({ pageIndex: 1, oldRect: [10, 20, 100, 140], rect: [10, 20, 120, 140], layer: "aboveText", quarterTurns: 1 }));
  });

  it("deletes the selected image", async () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Xóa ảnh" }));
    await waitFor(() => expect(host.deleteImage).toHaveBeenCalledWith({ pageIndex: 1, oldRect: [10, 20, 100, 140] }));
  });

  it("replaces the selected image from a file", async () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    chooseFile(new File([Uint8Array.from([9, 8])], "replacement.jpg", { type: "image/jpeg" }));
    fireEvent.click(screen.getByRole("button", { name: "Thay ảnh" }));
    await waitFor(() => expect(host.replaceImage).toHaveBeenCalledWith(expect.objectContaining({ target: { page: 2, objectId: "image-1" }, image: expect.any(Uint8Array) })));
  });

  it("rejects a cleared coordinate instead of zeroing it", () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    const right = screen.getByRole("spinbutton", { name: "Phải" });
    fireEvent.change(right, { target: { value: "" } });
    expect(right).toHaveValue(null);
    expect(right).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Áp dụng thay đổi ảnh" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng thay đổi ảnh" }));
    expect(host.transformImage).not.toHaveBeenCalled();
  });

  it("flags fractional rotation and blocks apply", () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    const rotation = screen.getByRole("spinbutton", { name: "Góc xoay" });
    fireEvent.change(rotation, { target: { value: "1.5" } });
    expect(rotation).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Áp dụng thay đổi ảnh" })).toBeDisabled();
  });

  it("rejects a replacement file that is not PNG or JPEG", () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    chooseFile(new File(["x"], "note.pdf", { type: "application/pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Thay ảnh" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Chọn ảnh PNG hoặc JPEG.");
    expect(host.replaceImage).not.toHaveBeenCalled();
  });

  it("rejects an oversized replacement before reading it", () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    const file = new File([Uint8Array.from([9, 8])], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: MAX_PDF_IMAGE_BYTES + 1 });
    chooseFile(file);
    fireEvent.click(screen.getByRole("button", { name: "Thay ảnh" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Không thể đọc ảnh.");
    expect(host.replaceImage).not.toHaveBeenCalled();
  });

  it("maps a vanished selection to localized copy", async () => {
    const host = provider();
    vi.mocked(host.replaceImage).mockRejectedValueOnce({ code: "object_unavailable" });
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    chooseFile(new File([Uint8Array.from([9, 8])], "replacement.jpg", { type: "image/jpeg" }));
    fireEvent.click(screen.getByRole("button", { name: "Thay ảnh" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nội dung đã chọn không còn khả dụng. Chọn lại."));
  });
});
