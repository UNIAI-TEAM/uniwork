import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PdfDocumentPropertiesDialog } from "./document-properties";

describe("PdfDocumentPropertiesDialog", () => {
  beforeEach(async () => { await setLocale("en"); });
  it("edits the four PDF metadata fields and sends them through setMetadata", async () => {
    const setMetadata = vi.fn(async () => undefined);
    render(
      <PdfDocumentPropertiesDialog
        open
        metadata={{ title: "Original", author: "A", subject: "S", keywords: "one" }}
        setMetadata={setMetadata}
        onOpenChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated" } });
    fireEvent.change(screen.getByLabelText("Keywords"), { target: { value: "one, two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setMetadata).toHaveBeenCalledWith({ title: "Updated", author: "A", subject: "S", keywords: "one, two" }));
  });

  it("resets drafts when reopened and keeps the dialog open when saving fails", async () => {
    const setMetadata = vi.fn(async () => { throw new Error("failed"); });
    const onOpenChange = vi.fn();
    const view = render(<PdfDocumentPropertiesDialog open metadata={{ title: "First" }} setMetadata={setMetadata} onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    view.rerender(<PdfDocumentPropertiesDialog open={false} metadata={{ title: "First" }} setMetadata={setMetadata} onOpenChange={onOpenChange} />);
    view.rerender(<PdfDocumentPropertiesDialog open metadata={{ title: "First" }} setMetadata={setMetadata} onOpenChange={onOpenChange} />);
    expect(screen.getByLabelText("Title")).toHaveValue("First");
  });
});
