import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PdfEditor } from "./pdf-editor";
import type { PdfCanvasPage, PdfPageRenderService } from "./canvas";
import type { PdfNoteThread } from "./notes";
import type { PdfEditorHandle, PdfOpenOutcome, PdfSaveCoordinator } from "./types";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const PAGES: PdfCanvasPage[] = [
  { pageNumber: 1, width: 200, height: 300 },
  { pageNumber: 2, width: 200, height: 300 },
];

const capability = { format: "pdf" as const, operation: "serialize", host: "browser", engineBuild: "test", contractRevision: "test", status: "available" as const, fidelityWarnings: [] };
const opened: PdfOpenOutcome = { outcome: "opened", document_id: "doc", document_model_ref: "m", warnings: [] };

function coordinator(): PdfSaveCoordinator {
  const state = { state: "ready" as const, identity: { deploymentId: "d", accountId: "a", organizationId: "o", workspaceId: "w", documentId: "doc", generation: 1, baseVersionId: "v", baseRevision: "1" }, dirtyGeneration: 0, lastSavedGeneration: 0, activeIntentId: null, error: null };
  return { getState: () => state, subscribe: () => () => undefined, save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })), markDirty: vi.fn() };
}

function host(overrides: Partial<PdfEditorHandle> = {}) {
  const renderer: PdfPageRenderService = { renderPage: vi.fn(async ({ pageNumber }) => ({ src: `data:image/png;base64,p${pageNumber}`, width: 200, height: 300 })) };
  const pdfPages = PAGES.map((page) => ({ pageNumber: page.pageNumber, rotation: 0 }));
  const handle: PdfEditorHandle = {
    format: "pdf",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 7,
    captureSnapshot: vi.fn(async () => ({ generation: 7, fingerprint: "fp", value: { pages: pdfPages, pageCount: 2 } })),
    undo: vi.fn(),
    redo: vi.fn(),
    dispose: vi.fn(),
    edit: vi.fn(async () => undefined),
    getPdfSnapshot: () => ({ pages: pdfPages, pageCount: 2 }),
    renderer,
    getCanvasPages: vi.fn(() => PAGES),
    submitEngineOperations: vi.fn(async () => ({ skipped: [] })),
    readFormFields: vi.fn(async () => [{ name: "fullName", kind: "text" as const, value: "" }]),
    searchText: vi.fn(async (query: string) => [{ id: "h1", page: 2, start: 0, end: query.length, text: query }]),
    subscribe: vi.fn(() => () => undefined),
    ...overrides,
  };
  return { handle, renderer };
}

async function mount(handle: PdfEditorHandle) {
  const save = coordinator();
  render(<PdfEditor documentKey="doc-1" editor={handle} open={{ open: vi.fn(async () => opened) }} coordinator={save} capability={capability} />);
  await waitFor(() => expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument());
  return save;
}

function openAnnotate(command: string) {
  fireEvent.click(screen.getByTestId("pdf-chrome-tab-annotate"));
  fireEvent.click(screen.getByRole("button", { name: command }));
}

function pageBackground(page: number) {
  return within(screen.getByTestId(`pdf-page-${page}`)).getByRole("button", { name: `Page ${page} background` });
}

const SAVED_NOTE: PdfNoteThread = {
  id: "t1",
  root: { id: "n1", page: 2, pageIndex: 1, objNum: 7, rect: [10, 20, 30, 40], contents: "Saved note", author: "An" },
  replies: [],
};

describe("PdfEditorSurface", () => {
  it("draws the pages through the host renderer instead of the empty box", async () => {
    const { handle, renderer } = host();
    await mount(handle);
    await waitFor(() => expect(renderer.renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1 })));
    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
  });

  it("shows rendered page previews in the frame rail, scaled to the rail width", async () => {
    const { handle, renderer } = host();
    await mount(handle);
    const rail = screen.getByTestId("pdf-thumbnails-rail");
    await waitFor(() => expect(within(rail).getByTestId("pdf-rail-thumbnail-2").querySelector("img")).not.toBeNull());
    expect(renderer.renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2, scale: 112 / 200 }));
    expect(within(rail).queryByTestId("pdf-thumbnail-placeholder-1")).toBeNull();
  });

  it("keeps the numbered rail placeholders when the host has no renderer", async () => {
    const { handle } = host({ renderer: undefined, getCanvasPages: undefined });
    await mount(handle);
    expect(within(screen.getByTestId("pdf-thumbnails-rail")).getByTestId("pdf-thumbnail-placeholder-1")).toBeInTheDocument();
  });

  it("fills the shell content area with one frame: no inner bordered card around the pages", async () => {
    // U4: the editor must not draw a second bordered, rounded card inside the
    // shell. Neither the document surface nor the canvas scroll region may carry
    // card chrome (rounded-lg / border / shadow-sm / a muted backdrop).
    const { handle } = host();
    await mount(handle);
    const surface = screen.getByTestId("pdf-document-surface");
    expect(surface.className).not.toContain("rounded-lg");
    expect(surface.className).not.toContain("shadow-sm");
    expect(surface.className).not.toContain("bg-muted/20");
    const scroller = screen.getByTestId("pdf-canvas-scroll");
    expect(scroller.className).not.toContain("bg-muted/20");
    expect(scroller.className).not.toContain("rounded-lg");
  });

  it("renders the renderer-less placeholder without an inner bordered card", async () => {
    // The placeholder branch must also fill the shell, not read as an inner card.
    const { handle } = host({ renderer: undefined, getCanvasPages: undefined });
    await mount(handle);
    const surface = screen.getByTestId("pdf-document-surface");
    expect(surface.className).not.toContain("rounded-lg");
    expect(surface.className).not.toContain("shadow-sm");
    expect(surface.className).not.toContain("bg-background");
    expect(surface.className).not.toContain("border");
  });

  it("highlights a dragged region as a markup edit and marks the document dirty", async () => {
    const { handle } = host();
    const save = await mount(handle);
    openAnnotate("Highlight");
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-tool", "region");
    const surface = pageBackground(1);
    fireEvent.pointerDown(surface, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 110, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 110, clientY: 40, pointerId: 1 });
    await waitFor(() => expect(screen.getByTestId("pdf-surface-hint")).toHaveTextContent("Area selected on page 1"));
    fireEvent.click(within(screen.getByTestId("pdf-editor-panels")).getByRole("button", { name: "Highlight" }));
    await waitFor(() => expect(handle.edit).toHaveBeenCalledTimes(1));
    // The canvas is top-left origin; the operation carries PDF user space (y' = 300 - y).
    expect(handle.edit).toHaveBeenCalledWith([expect.objectContaining({ op: "add_markup", type: "highlight", target: { page: 1, quads: [[10, 280, 110, 280, 10, 260, 110, 260]] } })]);
    await waitFor(() => expect(save.markDirty).toHaveBeenCalledWith(7));
  });

  it("places a note at the clicked point through the engine envelope", async () => {
    const { handle } = host();
    const save = await mount(handle);
    openAnnotate("Note");
    fireEvent.click(pageBackground(2), { clientX: 30, clientY: 50 });
    fireEvent.change(await screen.findByPlaceholderText("Write a note"), { target: { value: "Check this" } });
    fireEvent.click(within(screen.getByTestId("pdf-note-add")).getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(handle.submitEngineOperations).toHaveBeenCalledTimes(1));
    expect(handle.submitEngineOperations).toHaveBeenCalledWith([{ op: "addNote", attributes: { note: { pageIndex: 1, rect: [30, 226, 54, 250], contents: "Check this" } } }]);
    await waitFor(() => expect(save.markDirty).toHaveBeenCalledWith(7));
  });

  it("shows the saved note threads the host reads from the file", async () => {
    const readSavedNotes = vi.fn(async () => [SAVED_NOTE]);
    const { handle } = host({ readSavedNotes });
    await mount(handle);
    openAnnotate("Note");
    expect(await screen.findByText("Saved note")).toBeInTheDocument();
    expect(readSavedNotes).toHaveBeenCalled();
    expect(screen.queryByText("No notes in this document.")).not.toBeInTheDocument();
  });

  it("shows the loading state, never a false empty state, until the note reader resolves", async () => {
    let resolve: (threads: readonly PdfNoteThread[]) => void = () => undefined;
    const pending = new Promise<readonly PdfNoteThread[]>((done) => { resolve = done; });
    const { handle } = host({ readSavedNotes: vi.fn(() => pending) });
    await mount(handle);
    openAnnotate("Note");
    expect(screen.getByTestId("pdf-notes-loading")).toBeInTheDocument();
    expect(screen.queryByText("No notes in this document.")).not.toBeInTheDocument();
    await act(async () => { resolve([SAVED_NOTE]); });
    expect(await screen.findByText("Saved note")).toBeInTheDocument();
  });

  it("shows the empty state, never a permanent loading, when the host has no note reader", async () => {
    const { handle } = host();
    expect(handle.readSavedNotes).toBeUndefined();
    await mount(handle);
    openAnnotate("Note");
    expect(screen.queryByTestId("pdf-notes-loading")).not.toBeInTheDocument();
    expect(screen.getByText("No notes in this document.")).toBeInTheDocument();
  });

  it("keeps the editor alive and shows a translated message when reading saved notes fails", async () => {
    const { handle } = host({ readSavedNotes: vi.fn(async () => { throw new Error("engine down"); }) });
    await mount(handle);
    openAnnotate("Note");
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("could not be applied"))).toBe(true));
    expect(screen.queryByText(/engine down/)).not.toBeInTheDocument();
    expect(screen.queryByText("No notes in this document.")).not.toBeInTheDocument();
    expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument();
  });

  it("switches the page tool to point for stamps", async () => {
    const { handle } = host();
    await mount(handle);
    openAnnotate("Stamp");
    expect(screen.getByTestId("pdf-page-1")).toHaveAttribute("data-tool", "point");
    expect(screen.getByTestId("pdf-surface-hint")).toHaveTextContent("Click a page");
  });

  it("fills a form field from the document's fields", async () => {
    const { handle } = host();
    const save = await mount(handle);
    openAnnotate("Fill form");
    const input = await screen.findByLabelText("fullName");
    fireEvent.change(input, { target: { value: "An Nguyen" } });
    fireEvent.blur(input);
    await waitFor(() => expect(handle.submitEngineOperations).toHaveBeenCalledWith([{ op: "setFormValue", field: { name: "fullName", kind: "text", value: "An Nguyen" } }]));
    await waitFor(() => expect(save.markDirty).toHaveBeenCalled());
  });

  it("shows a translated message and keeps the editor alive when the engine refuses a value", async () => {
    const refused = Object.assign(new Error("setFormValue.value: cannot encode"), { name: "PdfOpError" });
    const { handle } = host({ submitEngineOperations: vi.fn(async () => { throw refused; }) });
    const save = await mount(handle);
    openAnnotate("Fill form");
    const input = await screen.findByLabelText("fullName");
    fireEvent.change(input, { target: { value: "Nguyễn Văn An" } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("cannot take this value"))).toBe(true));
    expect(screen.queryByText(/cannot encode/)).not.toBeInTheDocument();
    expect(screen.getByTestId("pdf-canvas")).toBeInTheDocument();
    expect(save.markDirty).not.toHaveBeenCalled();
  });

  it("names the font refusal when the engine skips a form value it cannot encode", async () => {
    const skipped = [{ op: "setFormValue", reason: "fullName: WinAnsi cannot encode \"ễ\"" }];
    const { handle } = host({ submitEngineOperations: vi.fn(async () => ({ skipped })) });
    await mount(handle);
    openAnnotate("Fill form");
    const input = await screen.findByLabelText("fullName");
    fireEvent.change(input, { target: { value: "Nguyễn Văn An" } });
    fireEvent.blur(input);
    expect(await screen.findByText(/its form font does not support them/)).toBeInTheDocument();
    expect(screen.queryByText(/browser cannot apply it/)).not.toBeInTheDocument();
  });

  it("rotates the selected page from the Pages tab", async () => {
    const { handle } = host();
    const save = await mount(handle);
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-pages"));
    fireEvent.click(screen.getByRole("button", { name: "Rotate page" }));
    expect(handle.edit).toHaveBeenCalledWith([{ op: "rotate_page", target: { page: 2 }, degrees: 90 }]);
    await waitFor(() => expect(save.markDirty).toHaveBeenCalledWith(7));
  });

  it("opens the page strip for reorder and delete", async () => {
    const { handle } = host();
    await mount(handle);
    fireEvent.click(screen.getByTestId("pdf-chrome-tab-pages"));
    fireEvent.click(screen.getByRole("button", { name: "Reorder page" }));
    const strip = screen.getByTestId("pdf-pages-panel");
    expect(strip).toBeInTheDocument();
    expect(within(strip).getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("feeds find hits from the host search and navigates to the hit's page", async () => {
    const { handle } = host();
    await mount(handle);
    fireEvent.click(screen.getByTestId("pdf-chrome-find"));
    fireEvent.change(screen.getByLabelText("Search PDF text"), { target: { value: "total" } });
    await waitFor(() => expect(handle.searchText).toHaveBeenCalledWith("total"));
    await waitFor(() => expect(screen.getByTestId("pdf-status-page")).toHaveTextContent("Page 2"));
  });

  it("paints a find hit's quads on the canvas and marks the active one", async () => {
    const searchText = vi.fn(async (query: string) => [
      { id: "h1", page: 2, start: 0, end: query.length, text: query, quads: [[10, 80, 40, 100]] as const },
      { id: "h2", page: 2, start: 5, end: 5 + query.length, text: query, quads: [[10, 40, 40, 60]] as const },
    ]);
    const { handle } = host({ searchText });
    await mount(handle);
    fireEvent.click(screen.getByTestId("pdf-chrome-find"));
    fireEvent.change(screen.getByLabelText("Search PDF text"), { target: { value: "total" } });
    const active = await screen.findByTestId("pdf-find-highlight-h1:0");
    const other = screen.getByTestId("pdf-find-highlight-h2:0");
    expect(active).toHaveAttribute("data-active", "true");
    expect(other).toHaveAttribute("data-active", "false");
    expect(active.className).not.toBe(other.className);
    // Page is 200x300: top = 300 - 100 = 200, height = 20, left = 10, width = 30.
    expect(active).toHaveStyle({ left: "10px", top: "200px", width: "30px", height: "20px" });
  });

  it("paints no find overlay when a hit carries no quads", async () => {
    const { handle } = host();
    await mount(handle);
    fireEvent.click(screen.getByTestId("pdf-chrome-find"));
    fireEvent.change(screen.getByLabelText("Search PDF text"), { target: { value: "total" } });
    await waitFor(() => expect(handle.searchText).toHaveBeenCalledWith("total"));
    await waitFor(() => expect(screen.getByTestId("pdf-status-page")).toHaveTextContent("Page 2"));
    expect(screen.getByTestId("pdf-find-highlights-2")).toBeEmptyDOMElement();
  });

  it("refreshes the canvas pages when the host reports changed bytes", async () => {
    let notify: () => void = () => undefined;
    const { handle } = host({ subscribe: vi.fn((listener: () => void) => { notify = listener; return () => undefined; }) });
    await mount(handle);
    const calls = vi.mocked(handle.getCanvasPages!).mock.calls.length;
    act(() => notify());
    await waitFor(() => expect(vi.mocked(handle.getCanvasPages!).mock.calls.length).toBeGreaterThan(calls));
  });
});
