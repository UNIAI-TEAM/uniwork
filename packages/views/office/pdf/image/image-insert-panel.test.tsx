import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfImageInsertPanel, readImageFile } from "./image-insert-panel";
import { MAX_PDF_IMAGE_BYTES } from "./provider";
import type { PdfImageOperationProvider } from "./types";

function provider(): PdfImageOperationProvider { return { insertImage: vi.fn(), transformImage: vi.fn(), replaceImage: vi.fn(), deleteImage: vi.fn() }; }
function choose(file: File): void { fireEvent.change(screen.getByLabelText("Chèn ảnh"), { target: { files: [file] } }); }

describe("PdfImageInsertPanel", () => {
  it("reads a selected file and submits a typed insert image request", async () => {
    const host = provider();
    render(<PdfImageInsertPanel page={2} provider={host} />);
    choose(new File([Uint8Array.from([1, 2, 3])], "stamp.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Chèn ảnh" }));
    await waitFor(() => expect(host.insertImage).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 1, layer: "aboveText", image: expect.any(Uint8Array) })));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects a file that is not PNG or JPEG", () => {
    const host = provider();
    render(<PdfImageInsertPanel page={2} provider={host} />);
    choose(new File(["x"], "note.pdf", { type: "application/pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Chèn ảnh" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Chọn ảnh PNG hoặc JPEG.");
    expect(host.insertImage).not.toHaveBeenCalled();
  });

  it("rejects an oversized image before reading it", () => {
    const host = provider();
    render(<PdfImageInsertPanel page={2} provider={host} />);
    const file = new File([Uint8Array.from([1, 2, 3])], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: MAX_PDF_IMAGE_BYTES + 1 });
    choose(file);
    fireEvent.click(screen.getByRole("button", { name: "Chèn ảnh" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Không thể đọc ảnh.");
    expect(host.insertImage).not.toHaveBeenCalled();
  });

  it("toggles the insert layer with pressed-state buttons", async () => {
    const host = provider();
    render(<PdfImageInsertPanel page={2} provider={host} />);
    expect(screen.getByRole("group", { name: "Lớp" })).toBeInTheDocument();
    const above = screen.getByRole("button", { name: "Trên chữ" });
    const below = screen.getByRole("button", { name: "Dưới chữ" });
    expect(above).toHaveAttribute("aria-pressed", "true");
    expect(below).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(below);
    expect(above).toHaveAttribute("aria-pressed", "false");
    expect(below).toHaveAttribute("aria-pressed", "true");
    choose(new File([Uint8Array.from([1])], "stamp.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Chèn ảnh" }));
    await waitFor(() => expect(host.insertImage).toHaveBeenCalledWith(expect.objectContaining({ layer: "belowText" })));
  });

  it("shows a localized alert when the host rejects the insert", async () => {
    const host = provider();
    vi.mocked(host.insertImage).mockRejectedValueOnce(new Error("engine down"));
    render(<PdfImageInsertPanel page={2} provider={host} />);
    choose(new File([Uint8Array.from([1])], "stamp.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Chèn ảnh" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Không thể áp dụng thay đổi PDF. Thử lại."));
  });

  it("falls back to FileReader when arrayBuffer is unavailable", async () => {
    const file = new File([Uint8Array.from([7, 8, 9])], "stamp.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: undefined });
    await expect(readImageFile(file)).resolves.toEqual(Uint8Array.from([7, 8, 9]));
  });
});
