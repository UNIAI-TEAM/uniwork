// UNI-957: a mixed set — DOCX, XLSX and PDF — mounted in one page the way the
// desktop keeps its tabs (only the visible tab is active). Keys, print and
// window events aimed at the visible PDF leave the hidden DOCX and XLSX alone.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { OfficeDocumentActiveProvider } from "./common/document-active";
import { createDocxCommandRuntime } from "./docx/commands";
import { DocxEditor } from "./docx/docx-editor";
import { docxExtensions } from "./docx/docx-schema";
import type { DocxEditorHandle, DocxOpenOutcome, DocxSaveCoordinator } from "./docx/types";
import { PdfEditor } from "./pdf/pdf-editor";
import type { PdfEditorHandle, PdfOpenOutcome, PdfSaveCoordinator } from "./pdf/types";
import { XLSX_FORMAT_PAINTER_OPERATION, XlsxFormatPainterButton } from "./xlsx/toolbar/clear/format-painter";
import type { XlsxToolbarCommands, XlsxToolbarGroupProps } from "./xlsx/toolbar/types";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

const available = { operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };

function docxHandle(): DocxEditorHandle {
  const live = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text: "hidden words" }] }] },
  });
  editors.push(live);
  return {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 0,
    captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
    dispose: vi.fn(),
    commands: createDocxCommandRuntime(() => live),
    renderSurface: () => (
      <div data-testid="docx-document-surface">
        <div className="doc-zoom"><EditorContent editor={live} /></div>
      </div>
    ),
  };
}

function docxCoordinator(): DocxSaveCoordinator {
  return {
    getState: () => ({ state: "clean", dirtyGeneration: 0, lastSavedGeneration: 0 }) as never,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  } as unknown as DocxSaveCoordinator;
}

function pdfHandle(): PdfEditorHandle {
  const pages = [{ pageNumber: 1, rotation: 0 }];
  return {
    format: "pdf",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 1,
    captureSnapshot: vi.fn(async () => ({ generation: 1, fingerprint: "fp", value: { pages, pageCount: 1 } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    cancel: vi.fn(),
    edit: vi.fn(),
    getPdfSnapshot: () => ({ pages, pageCount: 1 }),
    renderer: { renderPage: vi.fn(async () => ({ src: "", width: 0, height: 0 })) },
    getCanvasPages: () => [{ pageNumber: 1, width: 595, height: 842, rotation: 0 }],
  };
}

function pdfCoordinator(): PdfSaveCoordinator {
  const state = {
    state: "dirty" as const,
    identity: { deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "workspace", documentId: "doc", generation: 1, baseVersionId: "version", baseRevision: "1" },
    dirtyGeneration: 1, lastSavedGeneration: 0, activeIntentId: null, error: null,
  };
  return { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn() };
}

function painterProps(commands: XlsxToolbarCommands): XlsxToolbarGroupProps {
  return {
    readOnly: false, selection: { sheet: "Data", address: "A1" }, canUndo: true, canRedo: true, canRecalculate: true, canFormat: true,
    recalculating: false, formatState: null, onUndo: vi.fn(), onRedo: vi.fn(), onNumberFormat: vi.fn(), onRecalculate: vi.fn(),
    onCopy: vi.fn(), onPaste: vi.fn(), onShowSheets: vi.fn(), commands,
  };
}

/** DOCX and XLSX in hidden tabs, the PDF visible. */
async function renderMixedTabs() {
  const xlsxExecute = vi.fn(() => true);
  const docxOpened: DocxOpenOutcome = { outcome: "opened", document_id: "docx", document_model_ref: "docx", warnings: [] };
  const pdfOpened: PdfOpenOutcome = { outcome: "opened", document_id: "pdf", document_model_ref: "m", warnings: [] };
  render(
    <>
      <div data-testid="tab-docx" hidden>
        <OfficeDocumentActiveProvider active={false}>
          <DocxEditor documentKey="docx" editor={docxHandle()} open={{ open: async () => docxOpened }} coordinator={docxCoordinator()} capability={{ format: "docx", ...available }} showDocumentControls={false} />
        </OfficeDocumentActiveProvider>
      </div>
      <div data-testid="tab-xlsx" hidden>
        <OfficeDocumentActiveProvider active={false}><XlsxFormatPainterButton {...painterProps({ execute: xlsxExecute })} /></OfficeDocumentActiveProvider>
      </div>
      <div data-testid="tab-pdf">
        <OfficeDocumentActiveProvider active>
          <PdfEditor documentKey="pdf" editor={pdfHandle()} open={{ open: vi.fn(async () => pdfOpened) }} coordinator={pdfCoordinator()} capability={{ format: "pdf", ...available }} />
        </OfficeDocumentActiveProvider>
      </div>
    </>,
  );
  const tabDocx = screen.getByTestId("tab-docx");
  const tabXlsx = screen.getByTestId("tab-xlsx");
  await waitFor(() => {
    expect(within(tabDocx).getByTestId("docx-document-surface")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument();
  });
  return { tabDocx, tabXlsx, xlsxExecute };
}

describe("mixed DOCX + XLSX + PDF tabs (UNI-957)", () => {
  it("keeps the hidden DOCX Find and XLSX format painter when Escape is pressed in the visible PDF", async () => {
    const { tabDocx, tabXlsx, xlsxExecute } = await renderMixedTabs();
    fireEvent.click(within(tabDocx).getByTestId("docx-find-toggle"));
    fireEvent.click(within(tabXlsx).getByTestId("xlsx-format-painter"));
    await waitFor(() => expect(within(tabDocx).getByTestId("docx-find-panel")).toBeInTheDocument());
    await waitFor(() => expect(within(tabXlsx).getByTestId("xlsx-format-painter")).toHaveAttribute("aria-pressed", "true"));
    xlsxExecute.mockClear();

    fireEvent.keyDown(screen.getByTestId("pdf-editor"), { key: "Escape" });

    expect(within(tabDocx).getByTestId("docx-find-panel")).toBeInTheDocument();
    expect(within(tabXlsx).getByTestId("xlsx-format-painter")).toHaveAttribute("aria-pressed", "true");
    expect(xlsxExecute).not.toHaveBeenCalledWith(XLSX_FORMAT_PAINTER_OPERATION, expect.anything());
  });

  it("never stamps the app window for print: a native print of the visible PDF stays untouched", async () => {
    await renderMixedTabs();
    // UNI-952: DOCX prints a document copy through its port, so no app-window
    // print marker exists for a hidden DOCX to set.
    window.dispatchEvent(new Event("beforeprint"));
    expect(document.body.hasAttribute("data-docx-printing")).toBe(false);
    window.dispatchEvent(new Event("afterprint"));
  });
});
