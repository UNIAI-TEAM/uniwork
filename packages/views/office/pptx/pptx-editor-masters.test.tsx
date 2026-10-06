import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { clearPptxThumbnailCache } from "./canvas/use-pptx-thumbnails";
import { run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor } from "./pptx-editor";

/**
 * UNI-939 T01 (B6): View > Slide master mounts the master view in place of the
 * tab panel, its edits ride the editor's one edit channel, and Close master
 * returns to the deck.
 */
initI18n();
beforeEach(async () => {
  await setLocale("en");
  clearPptxThumbnailCache();
});

const MASTER = "ppt/slideMasters/slideMaster1.xml";
const deck = { deck: { slides: [{ id: "s1" }], size: { cx: 12192000, cy: 6858000 } }, revision: 1 };

const host = (): OfficeHost => ({ read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } });

const module = (): PptxRendererModule => ({
  makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  buildRenderSlide: () => slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "Title" })], top: 0, height: 24 }] }) })]),
});

/** A desktop-style handle: the master reads live on the handle, not in props. */
function handle() {
  const edit = vi.fn(async () => ({ revision: 2 }));
  const value = {
    format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn(), edit,
    masterParts: () => [{ partPath: MASTER, kind: "master" as const, name: "Office Theme" }],
    masterElements: () => [{ id: "e_2", type: "shape", label: "title", placeholder: "title", box: { x: 1, y: 2, w: 3, h: 4 }, fill: null }],
  };
  return { handle: value as unknown as EditorHandle, edit };
}

const toggle = () => document.querySelector('[data-ribbon-item="slideMaster"]') as HTMLElement;
const mastersPanel = () => document.querySelector("[data-pptx-masters-panel]");

describe("PptxEditor slide master view (T01)", () => {
  it("opens from View > Slide master, edits through the handle and closes back to the deck", async () => {
    const { handle: editorHandle, edit } = handle();
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    expect(mastersPanel()).toBeNull();
    fireEvent.click(toggle());
    expect(mastersPanel()).not.toBeNull();
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    // MAJOR-2: the canvas shows the active part (the master opens first), not deck slide 1.
    const canvas = () => document.querySelector("[data-slide-canvas]") as HTMLElement;
    await waitFor(() => expect(canvas().querySelector("[data-pptx-master-preview]")).not.toBeNull());
    expect(canvas().querySelector('[data-master-element-id="e_2"]')).not.toBeNull();
    expect(canvas().querySelector("[data-pptx-master-preview-label]")).toHaveTextContent("Master: Office Theme (simplified preview)");

    // The handle's readers feed the view; a rename leaves through the handle's edit port.
    fireEvent.click(screen.getByText("Office Theme"));
    fireEvent.change(screen.getByLabelText("Master name"), { target: { value: "Brand" } });
    fireEvent.click(document.querySelector("[data-pptx-masters-rename]") as HTMLElement);
    await waitFor(() => expect(edit).toHaveBeenCalledWith([{ op: "master_rename", part: MASTER, name: "Brand" }]));

    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    expect(mastersPanel()).toBeNull();
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector("[data-pptx-master-preview]")).toBeNull();
    expect(document.querySelector("[data-pptx-master-preview-label]")).toBeNull();
    // Close master brings the deck slide back on the same canvas.
    expect(screen.getByText("Title")).toBeInTheDocument();
  });

  it("disables deck-slide edits while the master view hides the slide (F1)", async () => {
    const { handle: editorHandle, edit } = handle();
    const onTextEdit = vi.fn(async () => undefined);
    render(<PptxEditor host={host()} editorHandle={editorHandle} loadRendererModule={async () => module()} slides={[{ id: "s1" }]} deck={deck} onTextEdit={onTextEdit} onCommitText={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Title")).toBeInTheDocument());
    const item = (id: string) => document.querySelector(`[data-ribbon-item="${id}"]`) as HTMLElement;
    const rowOf = (menu: HTMLElement, action: string) => menu.querySelector(`[data-pptx-context-item="${action}"]`) as HTMLElement;
    const application = () => screen.getByRole("application", { name: "PowerPoint slide canvas" });

    // Baseline: a slide selection makes the slide commands live.
    fireEvent.keyDown(application(), { key: "a", ctrlKey: true });
    await waitFor(() => expect(item("font-bold")).not.toHaveAttribute("aria-disabled"));
    expect(item("edit-text")).not.toHaveAttribute("aria-disabled");

    fireEvent.click(screen.getByRole("tab", { name: "View" }));
    fireEvent.click(toggle());
    await waitFor(() => expect(document.querySelector("[data-pptx-master-preview]")).not.toBeNull());

    // The hidden slide's selection is dropped and its ribbon commands wait for Close master.
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));
    await waitFor(() => expect(item("font-bold")).toHaveAttribute("aria-disabled", "true"));
    expect(item("edit-text")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item("edit-text"));
    expect(onTextEdit).not.toHaveBeenCalled();

    // The canvas context menu offers no slide edit over the preview.
    fireEvent.contextMenu(application());
    const menu = await screen.findByRole("menu");
    for (const action of ["delete", "bring-to-front", "send-to-back", "edit-text", "insert"]) {
      expect(rowOf(menu, action)).toHaveAttribute("aria-disabled", "true");
      expect(rowOf(menu, action)).toHaveAttribute("data-capability", "unavailable");
    }
    expect(menu).toHaveTextContent("Close the master view to edit slides");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(edit).not.toHaveBeenCalled();

    // Close master (and the View tab toggle) stay usable; the slide commands return.
    fireEvent.click(screen.getByRole("button", { name: "Close master view" }));
    expect(item("edit-text")).not.toHaveAttribute("aria-disabled");
  });
});
