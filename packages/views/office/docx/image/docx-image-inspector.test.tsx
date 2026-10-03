import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocxImageInspector } from "./docx-image-inspector";
import type { DocxImageEditing, DocxImageInsertPayload } from "./docx-image-commands";
import type { DocxImageEdit, DocxImageInfo } from "./docx-image-model";

function createFakeEditing(info: DocxImageInfo | null) {
  const inserted: DocxImageInsertPayload[] = [];
  const edits: DocxImageEdit[] = [];
  let removes = 0;
  const port: DocxImageEditing = {
    getSelected: () => info,
    subscribe: () => () => undefined,
    insert: (payload) => {
      inserted.push(payload);
      return true;
    },
    apply: (edit) => {
      edits.push(edit);
    },
    remove: () => {
      removes += 1;
    },
  };
  return { port, inserted, edits, removes: () => removes };
}

const info = (overrides: Partial<DocxImageInfo> = {}): DocxImageInfo => ({
  docxIndex: 3,
  dataUrl: "data:image/png;base64,AQID",
  widthPx: 200,
  heightPx: 100,
  align: null,
  wrap: null,
  offsetXEmu: null,
  offsetYEmu: null,
  posH: null,
  posV: null,
  rotDeg: 0,
  flipH: false,
  flipV: false,
  altText: null,
  ...overrides,
});

describe("DocxImageInspector", () => {
  it("commits a locked-aspect size edit on blur", () => {
    const { port, edits } = createFakeEditing(info());
    render(<DocxImageInspector info={info()} editing={port} />);
    const width = screen.getByTestId("docx-image-inspector-width");
    fireEvent.change(width, { target: { value: "100" } });
    expect(screen.getByTestId("docx-image-inspector-height")).toHaveValue("50");
    fireEvent.blur(width);
    expect(edits).toEqual([{ kind: "size", widthPx: 100, heightPx: 50 }]);
  });

  it("routes align, rotate, flip and delete through the editing port", () => {
    const { port, edits, removes } = createFakeEditing(info({ rotDeg: 90, flipH: true }));
    render(<DocxImageInspector info={info({ rotDeg: 90, flipH: true })} editing={port} />);
    fireEvent.click(screen.getByTestId("docx-image-align-center"));
    fireEvent.click(screen.getByTestId("docx-image-rotate-right"));
    fireEvent.click(screen.getByTestId("docx-image-rotate-left"));
    fireEvent.click(screen.getByTestId("docx-image-flip-v"));
    fireEvent.click(screen.getByTestId("docx-image-delete"));
    expect(edits).toEqual([
      { kind: "align", align: "center" },
      { kind: "rotate", deg: 180 },
      { kind: "rotate", deg: 0 },
      { kind: "flip", flipH: true, flipV: true },
    ]);
    expect(removes()).toBe(1);
  });

  it("shows position presets only for saved pictures and offsets only when floating", () => {
    const saved = createFakeEditing(info({ wrap: "square-left" }));
    const view = render(<DocxImageInspector info={info({ wrap: "square-left" })} editing={saved.port} />);
    expect(screen.getByTestId("docx-image-position-center-center")).toBeInTheDocument();
    expect(screen.getByTestId("docx-image-offset-x")).toBeInTheDocument();
    view.unmount();
    const pending = createFakeEditing(info({ docxIndex: null, wrap: null }));
    render(<DocxImageInspector info={info({ docxIndex: null, wrap: null })} editing={pending.port} />);
    expect(screen.queryByTestId("docx-image-position-center-center")).not.toBeInTheDocument();
    expect(screen.queryByTestId("docx-image-offset-x")).not.toBeInTheDocument();
  });

  it("commits a position preset and a numeric offset", () => {
    const { port, edits } = createFakeEditing(info({ wrap: "square-left" }));
    render(<DocxImageInspector info={info({ wrap: "square-left" })} editing={port} />);
    fireEvent.click(screen.getByTestId("docx-image-position-bottom-right"));
    fireEvent.change(screen.getByTestId("docx-image-offset-x"), { target: { value: "10" } });
    fireEvent.change(screen.getByTestId("docx-image-offset-y"), { target: { value: "20" } });
    fireEvent.blur(screen.getByTestId("docx-image-offset-y"));
    expect(edits).toEqual([
      { kind: "position", h: "right", v: "bottom" },
      { kind: "offset", xEmu: 95250, yEmu: 190500 },
    ]);
  });

  it("replaces the picture bytes with the new aspect fitted to the current width", async () => {
    const { port, edits } = createFakeEditing(info());
    render(<DocxImageInspector info={info()} editing={port} measure={async () => ({ width: 400, height: 400 })} />);
    fireEvent.change(screen.getByTestId("docx-image-replace-input"), {
      target: { files: [new File([new Uint8Array([9, 9])], "new.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({ kind: "bytes", base64: "CQk=", mime: "image/png", widthPx: 200, heightPx: 200 });
  });

  it("disables every command when read-only", () => {
    const { port, edits } = createFakeEditing(info());
    render(<DocxImageInspector info={info()} editing={port} readOnly />);
    expect(screen.getByTestId("docx-image-delete")).toBeDisabled();
    expect(screen.getByTestId("docx-image-inspector-width")).toBeDisabled();
    expect(screen.getByTestId("docx-image-align-center")).toBeDisabled();
    expect(screen.getByTestId("docx-image-rotate-right")).toBeDisabled();
    expect(screen.getByTestId("docx-image-replace")).toBeDisabled();
    expect(screen.getByTestId("docx-image-crop")).toBeDisabled();
    fireEvent.click(screen.getByTestId("docx-image-align-center"));
    expect(edits).toHaveLength(0);
  });
});
