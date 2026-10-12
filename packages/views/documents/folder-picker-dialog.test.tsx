import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { FolderPickerDialog } from "./folder-picker-dialog";

const { t } = initI18n();

const tree: DocumentTreeNode[] = [
  { id: "f1", title: "Hợp đồng", kind: "folder", parent_id: null, position: 0, children: [] },
];

function renderPicker(over: Partial<React.ComponentProps<typeof FolderPickerDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    title: "Di chuyển",
    description: "Chọn thư mục",
    submitLabel: "Xong",
    tree,
    initialFolderId: null,
    pending: false,
    error: null,
    onSubmit: vi.fn(),
    ...over,
  };
  render(<FolderPickerDialog {...props} />);
  return props;
}

describe("FolderPickerDialog", () => {
  it("marks the picked target with aria-pressed buttons and submits it", () => {
    const props = renderPicker();
    const group = screen.getByRole("group", { name: t("documents.home.save_source.picker_label") });
    expect(group).toBeInTheDocument();
    const folder = screen.getByRole("button", { name: "Hợp đồng" });
    expect(folder).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Xong" }));
    expect(props.onSubmit).toHaveBeenCalledWith("f1");
  });

  it("holds its buttons with aria-disabled while pending: they keep focus and do nothing", () => {
    const props = renderPicker({ pending: true });
    const submit = screen.getByRole("button", { name: "Xong" });
    const cancel = screen.getByRole("button", { name: t("documents.upload.cancel") });
    for (const button of [submit, cancel]) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
    }
    fireEvent.click(submit);
    fireEvent.click(cancel);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });
});
