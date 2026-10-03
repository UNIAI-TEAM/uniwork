import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfTextInsertPanel } from "./text-insert-panel";
import type { PdfTextOperationProvider } from "./types";

const provider = (): PdfTextOperationProvider => ({ putTextEdit: vi.fn(), addTextInsert: vi.fn() });

describe("PdfTextInsertPanel", () => {
  it("submits an addTextInsert envelope with zero-based page coordinates", async () => {
    const host = provider();
    render(<PdfTextInsertPanel page={3} provider={host} origin={[72, 100]} />);
    fireEvent.change(screen.getByTestId("pdf-text-insert-panel").querySelector("#pdf-text-insert-input") as HTMLInputElement, { target: { value: "inserted" } });
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng chữ" }));
    await waitFor(() => expect(host.addTextInsert).toHaveBeenCalledWith({ pageIndex: 2, origin: [72, 100], text: "inserted", fontSize: 12, color: [0, 0, 0] }));
  });
});
