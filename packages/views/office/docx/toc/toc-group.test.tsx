// B7 (UNI-924): the Insert ▸ Table of contents group — the dialog wiring, the
// depth/page-number/hyperlink options it passes on, the Update gating on
// docxTocPresent and the inline notice. Labels are the Vietnamese copy the
// views suite runs in.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxCommandRuntime } from "../commands";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { TocGroup } from "./toc-group";

function runtime(overrides: Partial<Record<string, unknown>> = {}): DocxCommandRuntime {
  return {
    insertDocxToc: vi.fn(() => ({ outcome: "inserted", entries: 2 })),
    updateDocxToc: vi.fn(() => ({ outcome: "updated", entries: 2 })),
    readDocxTocHeadings: vi.fn(() => [
      { level: 1, text: "Một" },
      { level: 2, text: "Hai" },
    ]),
    ...overrides,
  } as unknown as DocxCommandRuntime;
}

function renderGroup(options: { commands?: DocxCommandRuntime; present?: boolean; readOnly?: boolean } = {}) {
  const commands = "commands" in options ? options.commands : runtime();
  const props: DocxToolbarGroupContext = {
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: { docxTocPresent: options.present ?? false } as unknown as DocxToolbarGroupContext["format"],
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
  render(<TocGroup {...props} />);
  return { commands };
}

describe("TocGroup", () => {
  it("inserts a TOC with the dialog's options and reports the entry count", () => {
    const { commands } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Chèn mục lục" }));
    expect(screen.getByTestId("docx-toc-preview")).toHaveTextContent("2 tiêu đề phù hợp.");
    fireEvent.click(screen.getByRole("button", { name: "Chèn" }));
    expect(commands?.insertDocxToc).toHaveBeenCalledWith({ maxLevel: 3, pageNumbers: true, hyperlinks: true });
    expect(screen.getByTestId("docx-toc-notice")).toHaveTextContent("Đã chèn 2 mục.");
  });

  it("disables the update entry until the document has a TOC", () => {
    renderGroup({ present: false });
    expect(screen.getByRole("button", { name: "Cập nhật mục lục" })).toBeDisabled();
  });

  it("updates the existing TOC and reports the refreshed entries", () => {
    const { commands } = renderGroup({ present: true });
    const update = screen.getByRole("button", { name: "Cập nhật mục lục" });
    expect(update).toBeEnabled();
    fireEvent.click(update);
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật" }));
    expect(commands?.updateDocxToc).toHaveBeenCalledWith({ maxLevel: 3, pageNumbers: true, hyperlinks: true });
    expect(screen.getByTestId("docx-toc-notice")).toHaveTextContent("Đã cập nhật mục lục: 2 mục.");
  });

  it("reports a missing TOC without opening a dialog outcome", () => {
    const { commands } = renderGroup({ present: true, commands: runtime({ updateDocxToc: vi.fn(() => ({ outcome: "missing", entries: 0 })) }) });
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật mục lục" }));
    fireEvent.click(screen.getByRole("button", { name: "Cập nhật" }));
    expect(screen.getByTestId("docx-toc-notice")).toHaveTextContent("Không tìm thấy mục lục trong tài liệu này.");
    expect(commands?.updateDocxToc).toHaveBeenCalled();
  });

  it("keeps both entries disabled on a read-only document", () => {
    renderGroup({ present: true, readOnly: true });
    expect(screen.getByRole("button", { name: "Chèn mục lục" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cập nhật mục lục" })).toBeDisabled();
  });
});
