// B7 (UNI-924): the Insert ▸ Captions and citations group — the caption dialog
// passes the localized label plus the text, the citation dialog previews and
// inserts the bracketed reference.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { CaptionGroup } from "./caption-group";

function runtime(overrides: Partial<Record<string, unknown>> = {}): DocxCommandRuntime {
  return {
    insertDocxCaption: vi.fn(() => true),
    insertDocxCitation: vi.fn(() => true),
    ...overrides,
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; readOnly?: boolean } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: null,
    commands,
    selection: null,
    readOnly: options.readOnly ?? false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  render(<CaptionGroup {...props} />);
  return { commands };
}

describe("CaptionGroup", () => {
  it("inserts a caption with the localized label and the typed text", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn chú thích" }));
    fireEvent.change(screen.getByTestId("docx-caption-text"), { target: { value: "Mô tả hình" } });
    fireEvent.click(screen.getByRole("button", { name: "Chèn" }));
    expect(commands?.insertDocxCaption).toHaveBeenCalledWith("Hình", "Mô tả hình");
    expect(screen.getByTestId("docx-caption-notice")).toHaveTextContent("Đã chèn chú thích.");
  });

  it("previews and inserts the bracketed citation", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn trích dẫn" }));
    fireEvent.change(screen.getByTestId("docx-citation-author"), { target: { value: "Nguyễn" } });
    fireEvent.change(screen.getByTestId("docx-citation-year"), { target: { value: "2024" } });
    expect(screen.getByTestId("docx-citation-preview")).toHaveTextContent("(Nguyễn, 2024)");
    fireEvent.click(screen.getByRole("button", { name: "Chèn" }));
    expect(commands?.insertDocxCitation).toHaveBeenCalledWith("Nguyễn", "2024");
    expect(screen.getByTestId("docx-caption-notice")).toHaveTextContent("Đã chèn trích dẫn.");
  });

  it("disables the empty citation insert and the read-only entries", () => {
    renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn trích dẫn" }));
    expect(screen.getByRole("button", { name: "Chèn" })).toBeDisabled();
    expect(screen.getByTestId("docx-citation-preview")).toHaveTextContent("Nhập tác giả hoặc năm.");
  });

  it("keeps both entries disabled on a read-only document", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Chèn chú thích" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chèn trích dẫn" })).toBeDisabled();
  });
});
