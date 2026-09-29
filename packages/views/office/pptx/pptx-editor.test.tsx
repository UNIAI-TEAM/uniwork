import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { EditorHandle, OfficeHost } from "@uniwork/core/office";
import { PptxEditor } from "./pptx-editor";

initI18n();
beforeEach(async () => { await setLocale("en"); });

function makeHost(call: ReturnType<typeof vi.fn>): OfficeHost {
  return { read: {} as never, write: { writeOutput: vi.fn() }, assets: {} as never, ipc: { call: call as unknown as OfficeHost["ipc"]["call"], send: vi.fn(), subscribe: vi.fn() } };
}

function handle() {
  return { format: "pptx", open: vi.fn(), getDirtyGeneration: () => 0, captureSnapshot: vi.fn(), undo: vi.fn(), redo: vi.fn(), dispose: vi.fn() } as unknown as EditorHandle;
}

describe("PptxEditor", () => {
  it("routes shape gestures through the host channel and waits before undo", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn(() => new Promise((done) => { resolve = done; }));
    const editorHandle = handle();
    render(
      <PptxEditor
        host={makeHost(call)}
        editorHandle={editorHandle}
        slides={[{ id: "s1" }]}
        elements={[{ id: "shape-1", type: "shape" }]}
        transformRequest={{ slideIndex: 0, sourceId: "shape-1", xPx: 24, yPx: 16, wPx: 320, hPx: 180, fitWidthPx: 960 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Shape / image" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("host:slides-edit-transform", expect.objectContaining({ slideIndex: 0, sourceId: "shape-1" })));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editorHandle.undo).not.toHaveBeenCalled();
    resolve({ slide: 0 });
    await waitFor(() => expect(editorHandle.undo).toHaveBeenCalledTimes(1));
  });

  it("uses the save coordinator and never writes bytes from the toolbar", () => {
    const call = vi.fn();
    const save = vi.fn(async () => undefined);
    const host = makeHost(call);
    render(<PptxEditor host={host} editorHandle={handle()} slides={[{ id: "s1" }]} saveCoordinator={{ save, getState: () => ({}) as never }} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith("button");
    expect(host.write.writeOutput).not.toHaveBeenCalled();
  });

  it("does not advertise edit commands without a bound host operation", () => {
    render(<PptxEditor host={makeHost(vi.fn())} editorHandle={handle()} slides={[{ id: "s1" }]} />);
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Text" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shape / image" })).toBeDisabled();
  });

  it("opens presenter mode over the selected slide without another editor", () => {
    const call = vi.fn();
    const view = render(<PptxEditor host={makeHost(call)} editorHandle={handle()} slides={[{ id: "s1", label: "Intro" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Presenter" }));
    expect(screen.getByRole("dialog", { name: "Presenter view" })).toBeInTheDocument();
    expect(screen.getAllByText("Intro").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Close presenter" }));
    expect(screen.queryByRole("dialog", { name: "Presenter view" })).not.toBeInTheDocument();
    view.unmount();
  });

  it("disposes the one editor handle when the view unmounts", async () => {
    const editorHandle = handle();
    const view = render(<PptxEditor host={makeHost(vi.fn())} editorHandle={editorHandle} slides={[{ id: "s1" }]} />);
    view.unmount();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(editorHandle.dispose).toHaveBeenCalledTimes(1);
  });
});
