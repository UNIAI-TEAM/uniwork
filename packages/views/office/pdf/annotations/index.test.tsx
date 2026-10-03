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

describe("PdfAnnotationsPanel", () => {
  beforeEach(async () => { await setLocale("en"); });

  it("emits a guarded deleteSavedAnnot operation for a bound saved annotation", async () => {
    const onDeleteSavedAnnot = vi.fn(async () => undefined);
    render(<PdfAnnotationsPanel annotations={[savedHighlight]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation" }));

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

  it("keeps unbound annotation kinds read-only", () => {
    const onDeleteSavedAnnot = vi.fn();
    render(<PdfAnnotationsPanel annotations={[savedInk]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    expect(screen.getByTestId("pdf-annotation-annot-2")).toHaveTextContent("Ink");
    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete annotation" })).not.toBeInTheDocument();
    expect(onDeleteSavedAnnot).not.toHaveBeenCalled();
  });

  it("reports callback failures without changing the list or rewriting content", async () => {
    const onDeleteSavedAnnot = vi.fn(async () => { throw new Error("blocked"); });
    render(<PdfAnnotationsPanel annotations={[savedHighlight]} deleteSavedAnnot={onDeleteSavedAnnot} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete annotation" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByTestId("pdf-annotation-annot-1")).toHaveTextContent("Important");
  });
});
