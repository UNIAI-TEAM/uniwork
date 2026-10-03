import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfImageEditPanel } from "./image-edit-panel";
import type { PdfImageOperationProvider, PdfImageSelection } from "./types";

const selection: PdfImageSelection = { page: 2, objectId: "image-1", rect: [10, 20, 100, 140], layer: "aboveText" };
function provider(): PdfImageOperationProvider { return { insertImage: vi.fn(), transformImage: vi.fn(), replaceImage: vi.fn(), deleteImage: vi.fn() }; }

describe("PdfImageEditPanel", () => {
  it("submits move, resize and rotate through transformImage", async () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Right" }), { target: { value: "120" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Rotation" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply image changes" }));
    await waitFor(() => expect(host.transformImage).toHaveBeenCalledWith({ pageIndex: 1, oldRect: [10, 20, 100, 140], rect: [10, 20, 120, 140], layer: "aboveText", quarterTurns: 1 }));
  });

  it("deletes the selected image", async () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete image" }));
    await waitFor(() => expect(host.deleteImage).toHaveBeenCalledWith({ pageIndex: 1, oldRect: [10, 20, 100, 140] }));
  });

  it("replaces the selected image from a file", async () => {
    const host = provider();
    render(<PdfImageEditPanel selection={selection} provider={host} />);
    const file = new File([Uint8Array.from([9, 8])], "replacement.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Replace image file"), { target: { files: [file] } });
    fireEvent.click(screen.getAllByRole("button").find((button) => button.textContent === "Thay ảnh")!);
    await waitFor(() => expect(host.replaceImage).toHaveBeenCalledWith(expect.objectContaining({ target: { page: 2, objectId: "image-1" }, image: expect.any(Uint8Array) })));
  });
});
