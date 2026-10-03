import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EngineBoundaryError } from "@uniwork/office-contracts";
import { PdfTextEditPanel } from "./text-edit-panel";
import type { PdfTextSelection, PdfTextOperationProvider } from "./types";

const selection: PdfTextSelection = { page: 2, objectId: "run-1", rect: [10, 20, 100, 40], text: "old", fontSize: 11 };
const provider = (): PdfTextOperationProvider => ({ putTextEdit: vi.fn(), addTextInsert: vi.fn() });

describe("PdfTextEditPanel", () => {
  it("submits a browser-safe putTextEdit payload", async () => {
    const host = provider();
    render(<PdfTextEditPanel selection={selection} provider={host} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(host.putTextEdit).toHaveBeenCalledWith({ objectId: "run-1", pageIndex: 1, rect: [10, 20, 100, 40], oldText: "old", newText: "new", fontSize: 11 }));
  });

  it("names the font and size inputs after their own labels", () => {
    render(<PdfTextEditPanel selection={selection} provider={provider()} />);
    expect(screen.getByRole("textbox", { name: "Font" })).toHaveAttribute("placeholder", "Giữ font hiện tại");
    expect(screen.getByRole("spinbutton", { name: "Cỡ chữ" })).toBeInTheDocument();
  });

  it("turns an EngineBoundaryError font failure into localized messaging", async () => {
    const host = provider();
    vi.mocked(host.putTextEdit).mockRejectedValueOnce(
      new EngineBoundaryError("engine_result_invalid", { reason: "font_fallback_missing", font: "Noto Sans" }),
    );
    render(<PdfTextEditPanel selection={selection} provider={host} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Noto Sans"));
  });

  it("keeps apply disabled until the replacement changes", () => {
    render(<PdfTextEditPanel selection={selection} provider={provider()} />);
    const apply = screen.getByRole("button", { name: "Áp dụng chữ" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "new" } });
    expect(apply).toBeEnabled();
  });

  it("keeps apply disabled while the font size is not positive", () => {
    render(<PdfTextEditPanel selection={selection} provider={provider()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "new" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Cỡ chữ" }), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Áp dụng chữ" })).toBeDisabled();
  });

  it("reports a skipped edit instead of applying it", async () => {
    const host = provider();
    const onApplied = vi.fn();
    vi.mocked(host.putTextEdit).mockResolvedValueOnce({ warnings: [{ code: "edit_skipped", detail: "text page=2: no available font" }] });
    render(<PdfTextEditPanel selection={selection} provider={host} onApplied={onApplied} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Chữ thay thế" }), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Engine đã bỏ qua thay đổi này; tệp lưu không bao gồm nó."));
    expect(onApplied).not.toHaveBeenCalled();
  });
});
