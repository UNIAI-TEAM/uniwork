import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsMenuItems, HeaderActionsSlotProvider } from "../../layout/header-actions-slot";
import type { OfficePrintOutcome, OfficePrintPort } from "../print";
import type { PdfCanvasPage } from "./canvas";
import { PdfEditor } from "./pdf-editor";
import type { PdfEditorHandle, PdfOpenOutcome, PdfSaveCoordinator } from "./types";

const canvasPages: readonly PdfCanvasPage[] = [
  { pageNumber: 1, width: 595, height: 842, rotation: 0 },
  { pageNumber: 2, width: 842, height: 595, rotation: 0 },
];

function handle(overrides: Partial<PdfEditorHandle> = {}): PdfEditorHandle {
  const pages = [{ pageNumber: 1, rotation: 0 }, { pageNumber: 2, rotation: 0 }];
  return {
    format: "pdf",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { pages, pageCount: 2 } })),
    dispose: vi.fn(),
    getPdfSnapshot: () => ({ pages, pageCount: 2 }),
    renderer: { renderPage: vi.fn(async () => ({ src: "data:image/png;base64,AAAA", width: 10, height: 10 })) },
    getCanvasPages: () => canvasPages,
    ...overrides,
  };
}

const coordinator: PdfSaveCoordinator = {
  getState: () => ({ state: "clean", identity: null, dirtyGeneration: 0, lastSavedGeneration: 0, activeIntentId: null, error: null }) as never,
  subscribe: () => () => undefined,
  save: vi.fn(),
};
const capability = { format: "pdf" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };
const opened = (): PdfOpenOutcome => ({ outcome: "opened", document_id: "doc", document_model_ref: "model-1", warnings: [] });

function renderPdf(editor: PdfEditorHandle, printPort?: OfficePrintPort) {
  render(
    <HeaderActionsSlotProvider>
      <DropdownMenu open><DropdownMenuContent><HeaderActionsMenuItems /></DropdownMenuContent></DropdownMenu>
      <PdfEditor documentKey="doc" editor={editor} open={{ open: async () => opened() }} coordinator={coordinator} capability={capability} title="Hợp đồng.pdf" printPort={printPort} />
    </HeaderActionsSlotProvider>,
  );
}

describe("PdfEditor print (UNI-952)", () => {
  it("shows no Print entry when the host gave no port", async () => {
    renderPdf(handle());
    await waitFor(() => expect(screen.getByTestId("pdf-ribbon-bar")).toBeInTheDocument());
    expect(screen.queryByTestId("pdf-print")).not.toBeInTheDocument();
    expect(document.querySelector("[data-pdf-print]")).toBeNull();
  });

  it("shows no Print entry when the handle cannot render pages", async () => {
    renderPdf(handle({ renderer: undefined }), { print: vi.fn() });
    await waitFor(() => expect(screen.getByTestId("pdf-ribbon-bar")).toBeInTheDocument());
    expect(screen.queryByTestId("pdf-print")).not.toBeInTheDocument();
  });

  it("puts Print in the toolbar and the header menu, both printing the page copy through the port", async () => {
    const print = vi.fn(async (): Promise<OfficePrintOutcome> => ({ outcome: "printed" }));
    renderPdf(handle(), { print });
    await waitFor(() => expect(screen.getByTestId("pdf-print")).toBeInTheDocument());
    const menuItem = await waitFor(() => {
      const node = document.querySelector<HTMLElement>("[data-pdf-print]");
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });

    fireEvent.click(screen.getByTestId("pdf-print"));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("pdf-print")).toBeEnabled());
    fireEvent.click(menuItem);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));

    const request = print.mock.calls[0] as unknown as [{ html: string; title: string }];
    expect(request[0].title).toBe("Hợp đồng.pdf");
    const doc = new DOMParser().parseFromString(request[0].html, "text/html");
    expect(Array.from(doc.querySelectorAll(".pdf-print-page")).map((node) => node.getAttribute("data-page"))).toEqual(["1", "2"]);
  });

  it("reports a render failure as the generic error and never calls the port", async () => {
    const print = vi.fn();
    renderPdf(handle({ renderer: { renderPage: vi.fn(async () => { throw new Error("boom"); }) } }), { print });
    await waitFor(() => expect(screen.getByTestId("pdf-print")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("pdf-print"));
    expect(await screen.findByTestId("pdf-print-error")).toHaveTextContent("Không thể in tài liệu.");
    expect(print).not.toHaveBeenCalled();
  });
});
