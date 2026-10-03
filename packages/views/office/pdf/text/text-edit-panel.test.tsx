import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
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

  it("turns typed font failures into localized messaging", async () => {
    await setLocale("vi");
    const host = provider();
    vi.mocked(host.putTextEdit).mockRejectedValueOnce({ code: "engine_result_invalid", reason: "font_fallback_missing", fields: { font: "Noto Sans" } });
    render(<PdfTextEditPanel selection={selection} provider={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Noto Sans"));
  });
});
