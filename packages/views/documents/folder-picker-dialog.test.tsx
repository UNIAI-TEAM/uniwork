import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("cancels through the footer and by Escape when nothing is pending", () => {
    const props = renderPicker();
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.cancel") }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("ignores Escape while pending so the request is not abandoned half-way", () => {
    const props = renderPicker({ pending: true });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the refusal in place and keeps the picked target", () => {
    const props = renderPicker({ error: "Thư mục quá sâu" });
    expect(screen.getByRole("alert")).toHaveTextContent("Thư mục quá sâu");
    fireEvent.click(screen.getByRole("button", { name: "Hợp đồng" }));
    expect(screen.getByRole("button", { name: "Hợp đồng" })).toHaveAttribute("aria-pressed", "true");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("submits the workspace root as null and names an untitled folder", () => {
    const props = renderPicker({
      tree: [{ id: "f2", title: "", kind: "folder", parent_id: null, position: 0, children: [] }],
      initialFolderId: "f2",
    });
    expect(screen.getByRole("button", { name: t("documents.detail.untitled") })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.save_source.root") }));
    fireEvent.click(screen.getByRole("button", { name: "Xong" }));
    expect(props.onSubmit).toHaveBeenCalledWith(null);
  });

  it("starts from the initial folder again each time it opens", async () => {
    const props = { onOpenChange: vi.fn(), title: "Di chuyển", description: "Chọn", submitLabel: "Xong", tree, pending: false, error: null, onSubmit: vi.fn() };
    const { rerender } = render(<FolderPickerDialog {...props} open initialFolderId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Hợp đồng" }));
    expect(screen.getByRole("button", { name: "Hợp đồng" })).toHaveAttribute("aria-pressed", "true");
    rerender(<FolderPickerDialog {...props} open={false} initialFolderId={null} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(<FolderPickerDialog {...props} open initialFolderId={null} />);
    expect(await screen.findByRole("button", { name: "Hợp đồng" })).toHaveAttribute("aria-pressed", "false");
  });
});
