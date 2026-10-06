// UNI-957 - two PPTX editors stay mounted in one renderer (desktop tab strip); the hidden one never answers.
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import type { PptxRendererModule } from "./canvas/renderer-module";
import { run, shapeNode, slide, textLayout } from "./canvas/pptx-render-fixtures";
import { PptxEditor } from "./pptx-editor";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

const host: OfficeHost = { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: vi.fn() as never, send: vi.fn(), subscribe: vi.fn() } };
const deck = { deck: { slides: [{ id: "s1" }, { id: "s2" }], size: { cx: 12192000, cy: 6858000 } }, revision: 1 };
const rendererModule: PptxRendererModule = {
  makeViewport: (size, fitWidthPx) => ({ widthPx: fitWidthPx, heightPx: fitWidthPx * (size.cy / size.cx), scale: 1 }),
  buildRenderSlide: (_slide, _size, options: { fitWidthPx: number }) =>
    slide([shapeNode({ text: textLayout({ lines: [{ runs: [run({ text: "T" })], top: 0, height: 24 }] }) })], { widthPx: options.fitWidthPx, heightPx: options.fitWidthPx / 2 }),
};

function handle() {
  return { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn() } as unknown as EditorHandle;
}

function renderPair() {
  const visible = handle();
  const hidden = handle();
  render(
    <>
      <OfficeDocumentActiveProvider active>
        <div data-testid="a"><PptxEditor host={host} editorHandle={visible} loadRendererModule={async () => rendererModule} /></div>
      </OfficeDocumentActiveProvider>
      <OfficeDocumentActiveProvider active={false}>
        <div data-testid="b"><PptxEditor host={host} editorHandle={hidden} loadRendererModule={async () => rendererModule} /></div>
      </OfficeDocumentActiveProvider>
    </>,
  );
  return { visible, hidden };
}

describe("PPTX tab isolation", () => {
  it("opens find only in the active deck on Ctrl+F with nothing focused", async () => {
    renderPair();
    await screen.findAllByRole("application", { name: "PowerPoint slide canvas" });
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(event); });
    const panels = screen.getAllByRole("region", { name: "Find and replace" });
    expect(panels).toHaveLength(1);
    expect(screen.getByTestId("a")).toContainElement(panels[0]!);
  });

  it("undoes in the deck that has focus and never in the hidden one", async () => {
    const { visible, hidden } = renderPair();
    await screen.findAllByRole("application", { name: "PowerPoint slide canvas" });
    const ribbon = screen.getByTestId("a").querySelector("button");
    expect(ribbon).not.toBeNull();
    ribbon!.focus();
    act(() => { ribbon!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })); });
    await waitFor(() => expect(visible.undo).toHaveBeenCalledTimes(1));
    expect(hidden.undo).not.toHaveBeenCalled();
  });
});
