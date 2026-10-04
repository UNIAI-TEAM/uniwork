import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocxImageInsert } from "./docx-image-insert";
import type { DocxImageEditing, DocxImageInsertPayload } from "./docx-image-commands";
import { MAX_IMAGE_BYTES } from "./docx-image-model";

function createFakeEditing() {
  const inserted: DocxImageInsertPayload[] = [];
  const port: DocxImageEditing = {
    getSelected: () => null,
    subscribe: () => () => undefined,
    insert: (payload) => {
      inserted.push(payload);
      return true;
    },
    apply: () => undefined,
    remove: () => undefined,
  };
  return { port, inserted };
}

const measure = async () => ({ width: 1000, height: 500 });

function pick(input: HTMLElement, file: File | Record<string, unknown>) {
  fireEvent.change(input, { target: { files: [file] } });
}

describe("DocxImageInsert", () => {
  it("opens the dialog with a default size that keeps the aspect ratio", async () => {
    const { port } = createFakeEditing();
    render(<DocxImageInsert editing={port} measure={measure} />);
    pick(screen.getByTestId("docx-image-file-input"), new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
    await screen.findByTestId("docx-image-preview");
    expect(screen.getByTestId("docx-image-width-input")).toHaveValue("620");
    expect(screen.getByTestId("docx-image-height-input")).toHaveValue("310");
  });

  it("inserts the picked bytes at the locked aspect size with default alt text", async () => {
    const { port, inserted } = createFakeEditing();
    render(<DocxImageInsert editing={port} measure={measure} />);
    pick(screen.getByTestId("docx-image-file-input"), new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
    await screen.findByTestId("docx-image-preview");
    fireEvent.change(screen.getByTestId("docx-image-width-input"), { target: { value: "100" } });
    expect(screen.getByTestId("docx-image-height-input")).toHaveValue("50");
    fireEvent.click(screen.getByTestId("docx-image-insert-confirm"));
    expect(inserted).toEqual([
      { base64: "AQID", mime: "image/png", widthPx: 100, heightPx: 50, altText: "photo", label: "photo.png" },
    ]);
  });

  it("refuses an unsupported type before reading the file", async () => {
    const { port, inserted } = createFakeEditing();
    render(<DocxImageInsert editing={port} measure={measure} />);
    pick(screen.getByTestId("docx-image-file-input"), new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByTestId("docx-image-error")).toBeInTheDocument();
    expect(screen.queryByTestId("docx-image-preview")).not.toBeInTheDocument();
    expect(inserted).toHaveLength(0);
  });

  it("refuses a file above the size cap", async () => {
    const { port, inserted } = createFakeEditing();
    render(<DocxImageInsert editing={port} measure={measure} />);
    pick(screen.getByTestId("docx-image-file-input"), { name: "huge.png", type: "image/png", size: MAX_IMAGE_BYTES + 1 });
    expect(await screen.findByTestId("docx-image-error")).toBeInTheDocument();
    expect(inserted).toHaveLength(0);
  });

  it("disables the picker when read-only", () => {
    const { port } = createFakeEditing();
    render(<DocxImageInsert editing={port} readOnly measure={measure} />);
    expect(screen.getByTestId("docx-image-insert-button")).toBeDisabled();
    expect(screen.getByTestId("docx-image-file-input")).toBeDisabled();
  });
});
