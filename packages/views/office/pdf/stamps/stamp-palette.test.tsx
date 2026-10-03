import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfStampPalette } from "./stamp-palette";
import type { PdfStampOperationProvider, PdfStampSignatureSource } from "./types";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const placement = { pageIndex: 2, rect: [10, 20, 130, 80] as [number, number, number, number] };
const signature: PdfStampSignatureSource = { id: "s1", label: "Chữ ký của tôi", contentType: "image/png", image: "iVBORw0KGgo=" };

function provider(): PdfStampOperationProvider { return { placeStamp: vi.fn() }; }
function chooseFile(file: File) { fireEvent.change(screen.getByLabelText("Ảnh con dấu"), { target: { files: [file] } }); }

describe("PdfStampPalette", () => {
  it("places an image stamp through the typed provider seam", async () => {
    const host = provider();
    render(<PdfStampPalette placement={placement} provider={host} />);
    chooseFile(new File([PNG], "stamp.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng dấu ảnh" }));
    await waitFor(() =>
      expect(host.placeStamp).toHaveBeenCalledWith({
        kind: "image",
        contentType: "image/png",
        image: expect.any(String),
        placement: { pageIndex: 2, rect: [10, 20, 130, 80] },
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("places a saved signature as a stamp and reports the choice", async () => {
    const host = provider();
    const onSelectSignature = vi.fn();
    render(<PdfStampPalette placement={placement} provider={host} signatures={[signature]} onSelectSignature={onSelectSignature} />);
    fireEvent.click(screen.getByRole("button", { name: "Đóng dấu chữ ký: Chữ ký của tôi" }));
    await waitFor(() =>
      expect(host.placeStamp).toHaveBeenCalledWith({
        kind: "signature",
        signatureId: "s1",
        contentType: "image/png",
        image: "iVBORw0KGgo=",
        placement: { pageIndex: 2, rect: [10, 20, 130, 80] },
      }),
    );
    expect(onSelectSignature).toHaveBeenCalledWith(signature);
  });

  it("carries the chosen rotation into the placement", async () => {
    const host = provider();
    render(<PdfStampPalette placement={placement} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "90°" }));
    chooseFile(new File([PNG], "stamp.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng dấu ảnh" }));
    await waitFor(() => expect(host.placeStamp).toHaveBeenCalledWith(expect.objectContaining({ placement: expect.objectContaining({ quarterTurns: 90 }) })));
  });

  it("shows a localized alert when the engine seam cannot place yet", async () => {
    const host = provider();
    vi.mocked(host.placeStamp).mockRejectedValueOnce(Object.assign(new Error("later"), { code: "unsupported_operation" }));
    render(<PdfStampPalette placement={placement} provider={host} />);
    chooseFile(new File([PNG], "stamp.png", { type: "image/png" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng dấu ảnh" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Engine PDF hiện tại chưa đóng được con dấu."));
  });

  it("refuses a non-PNG/JPEG file without touching the provider", async () => {
    const host = provider();
    render(<PdfStampPalette placement={placement} provider={host} />);
    chooseFile(new File([Uint8Array.from([1, 2, 3])], "note.pdf", { type: "application/pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Đóng dấu ảnh" }));
    // prepareStampImage rejects on a microtask, so the alert lands a tick later.
    expect(await screen.findByRole("alert")).toHaveTextContent("Chọn ảnh PNG hoặc JPEG.");
    expect(host.placeStamp).not.toHaveBeenCalled();
  });

  it("keeps placement blocked without a target, but not the file picker", () => {
    const host = provider();
    render(<PdfStampPalette placement={null} provider={host} />);
    expect(screen.getByRole("button", { name: "Đóng dấu ảnh" })).toBeDisabled();
    expect(screen.getByLabelText("Ảnh con dấu")).toBeEnabled();
    expect(screen.getByText("Chọn một vị trí trên trang để đóng dấu.")).toBeInTheDocument();
  });

  it("marks the chosen signature row pressed", () => {
    const host = provider();
    render(<PdfStampPalette placement={placement} provider={host} signatures={[signature]} selectedSignatureId="s1" />);
    expect(screen.getByRole("button", { name: "Đóng dấu chữ ký: Chữ ký của tôi" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the empty-signature hint when the picker has none", () => {
    render(<PdfStampPalette placement={placement} provider={provider()} />);
    expect(screen.getByText("Chưa có chữ ký nào để đóng dấu.")).toBeInTheDocument();
  });

  it("disables every control in a read-only host", () => {
    const host = provider();
    render(<PdfStampPalette placement={placement} provider={host} signatures={[signature]} disabled />);
    expect(screen.getByLabelText("Ảnh con dấu")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đóng dấu ảnh" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đóng dấu chữ ký: Chữ ký của tôi" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "90°" })).toBeDisabled();
  });
});
