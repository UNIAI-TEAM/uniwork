import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { createPdfAnnotationOperationProvider, PdfAnnotationsPanel, type PdfSavedAnnotation } from "./index";

const savedHighlight: PdfSavedAnnotation = {
  id: "annot-1",
  page: 2,
  kind: "highlight",
  pageIndex: 1,
  objNum: 42,
  rect: [10, 20, 30, 40],
  contents: "Important",
};

const savedInk: PdfSavedAnnotation = {
  id: "annot-2",
  page: 2,
  kind: "ink",
  binding: "unbound",
  pageIndex: 1,
  objNum: 43,
  rect: [50, 60, 70, 80],
};

const savedStamp: PdfSavedAnnotation = {
  id: "annot-3",
  page: 4,
  kind: "stamp",
  pageIndex: 3,
  objNum: 44,
  rect: [1, 2, 3, 4],
};

describe("PdfAnnotationsPanel", () => {
  beforeEach(async () => { await setLocale("en"); });

  it("emits a guarded deleteSavedAnnot operation for a bound saved annotation", async () => {
    const onDeleteSavedAnnot = vi.fn(async () => undefined);
    render(<PdfAnnotationsPanel annotations={[savedHighlight]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation: Highlight, page 2" }));

    await waitFor(() => expect(onDeleteSavedAnnot).toHaveBeenCalledWith({
      pageIndex: 1,
      objNum: 42,
      subtype: "highlight",
      rect: [10, 20, 30, 40],
      contents: "Important",
    }));
  });

  it("wraps the guarded identity in a browser-safe deleteSavedAnnot envelope", async () => {
    const submit = vi.fn(async () => undefined);
    const provider = createPdfAnnotationOperationProvider({ submit });
    await provider.deleteSavedAnnot({ pageIndex: 1, objNum: 42, subtype: "highlight", rect: [10, 20, 30, 40] });
    expect(submit).toHaveBeenCalledWith([{ op: "deleteSavedAnnot", attributes: { pageIndex: 1, objNum: 42, subtype: "highlight", rect: [10, 20, 30, 40] } }]);
  });

  it("shows the empty message when no annotations are saved", () => {
    render(<PdfAnnotationsPanel annotations={[]} deleteSavedAnnot={vi.fn()} />);

    expect(screen.getByText("No saved annotations.")).toBeInTheDocument();
  });

  it("keeps unbound annotation kinds read-only", () => {
    const onDeleteSavedAnnot = vi.fn();
    render(<PdfAnnotationsPanel annotations={[savedInk]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    expect(screen.getByTestId("pdf-annotation-annot-2")).toHaveTextContent("Ink");
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(onDeleteSavedAnnot).not.toHaveBeenCalled();
  });

  it("labels unknown kinds with the generic annotation fallback", () => {
    render(<PdfAnnotationsPanel annotations={[savedStamp]} deleteSavedAnnot={vi.fn()} />);

    expect(screen.getByTestId("pdf-annotation-annot-3")).toHaveTextContent("Annotation");
  });

  it("disables every delete button while a delete is pending", async () => {
    let resolveDelete: (() => void) | undefined;
    const onDeleteSavedAnnot = vi.fn(() => new Promise<void>((resolve) => { resolveDelete = () => resolve(); }));
    render(<PdfAnnotationsPanel annotations={[savedHighlight, { ...savedHighlight, id: "annot-4", page: 3, pageIndex: 2, objNum: 45 }]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation: Highlight, page 2" }));
    await waitFor(() => { for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled(); });

    resolveDelete?.();
    await waitFor(() => { for (const button of screen.getAllByRole("button")) expect(button).toBeEnabled(); });
  });

  it("reports callback failures without changing the list or rewriting content", async () => {
    const onDeleteSavedAnnot = vi.fn(async () => { throw new Error("blocked"); });
    render(<PdfAnnotationsPanel annotations={[savedHighlight]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation: Highlight, page 2" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("pdf-annotation-annot-1")).toHaveTextContent("Important");
  });
});
