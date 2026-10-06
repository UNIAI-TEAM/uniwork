import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import { PdfEditor } from "./pdf-editor";
import type { PdfEditorHandle, PdfOpenOutcome, PdfSaveCoordinator } from "./types";

// UNI-957: the desktop keeps every open document mounted; a hidden PDF must not
// react to window-level events or shortcuts aimed at the visible one.
const capability = { format: "pdf" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };

function coordinator(): PdfSaveCoordinator {
  const state = {
    state: "dirty" as const,
    identity: { deploymentId: "dep", accountId: "account", organizationId: "org", workspaceId: "workspace", documentId: "doc", generation: 1, baseVersionId: "version", baseRevision: "1" },
    dirtyGeneration: 1, lastSavedGeneration: 0, activeIntentId: null, error: null,
  };
  return { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn() };
}

function editor(): PdfEditorHandle {
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

function doc(key: string, handle: PdfEditorHandle) {
  const outcome: PdfOpenOutcome = { outcome: "opened", document_id: key, document_model_ref: "m", warnings: [] };
  return <PdfEditor documentKey={key} editor={handle} open={{ open: vi.fn(async () => outcome) }} coordinator={coordinator()} capability={capability} />;
}

function stubPane(root: HTMLElement, width: number, height: number) {
  const pane = root.querySelector("[data-office-canvas]") as HTMLElement;
  Object.defineProperty(pane, "clientWidth", { value: width, configurable: true });
  Object.defineProperty(pane, "clientHeight", { value: height, configurable: true });
}

async function renderPair(activeA = true) {
  await setLocale("vi");
  const a = editor();
  const b = editor();
  render(
    <>
      <OfficeDocumentActiveProvider active={activeA}>{doc("a", a)}</OfficeDocumentActiveProvider>
      <OfficeDocumentActiveProvider active={!activeA}>{doc("b", b)}</OfficeDocumentActiveProvider>
    </>,
  );
  await waitFor(() => expect(screen.getAllByTestId("pdf-canvas")).toHaveLength(2));
  const [rootA, rootB] = screen.getAllByTestId("pdf-editor");
  return { a, b, rootA: rootA as HTMLElement, rootB: rootB as HTMLElement };
}

describe("PDF editor tab isolation (UNI-957)", () => {
  it("a window resize fits only the active document", async () => {
    const { rootA, rootB } = await renderPair(true);
    stubPane(rootA, 390, 575);
    stubPane(rootB, 390, 575);
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(within(rootA).getByTestId("pdf-status-zoom")).toHaveTextContent("60%"));
    expect(within(rootB).getByTestId("pdf-status-zoom")).toHaveTextContent("100%");
  });

  it("does not take focus for a document that is not the visible one", async () => {
    const { rootA, rootB } = await renderPair(false);
    expect(document.activeElement).toBe(rootB);
    expect(document.activeElement).not.toBe(rootA);
  });

  it("keyboard shortcuts act on the document that owns the focus only", async () => {
    const { a, b, rootA, rootB } = await renderPair(true);
    fireEvent.keyDown(rootA, { key: "f", ctrlKey: true });
    expect(within(rootA).getByRole("search")).toBeInTheDocument();
    expect(within(rootB).queryByRole("search")).not.toBeInTheDocument();
    fireEvent.keyDown(rootA, { key: "z", ctrlKey: true });
    expect(a.undo).toHaveBeenCalledTimes(1);
    expect(b.undo).not.toHaveBeenCalled();
  });
});
