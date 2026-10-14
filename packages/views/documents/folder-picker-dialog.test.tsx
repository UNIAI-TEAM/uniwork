import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { FolderPickerDialog } from "./folder-picker-dialog";

const { t } = initI18n();

const tree: DocumentTreeNode[] = [
  {
    id: "f1",
    title: "Hợp đồng",
    kind: "folder",
    parent_id: null,
    position: 0,
    children: [
      { id: "f1-sub", title: "Phụ lục", kind: "folder", parent_id: "f1", position: 0, children: [] },
    ],
  },
  { id: "f2", title: "Tài chính", kind: "folder", parent_id: null, position: 1, children: [] },
];

function buildDeepChain(maxLevel: number): DocumentTreeNode[] {
  const makeNode = (level: number): DocumentTreeNode => ({
    id: `lvl-${level}`,
    title: `Cấp ${level}`,
    kind: "folder",
    parent_id: level === 1 ? null : `lvl-${level - 1}`,
    position: 0,
    children: level < maxLevel ? [makeNode(level + 1)] : [],
  });
  return [makeNode(1)];
}

function renderPicker(over: Partial<React.ComponentProps<typeof FolderPickerDialog>> = {}) {
  const props: React.ComponentProps<typeof FolderPickerDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    title: t("documents.home.move.picker_title"),
    description: "Chọn thư mục",
    submitLabel: t("documents.home.move.submit"),
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
  it("gives a disabled row's full reason as a title so a truncated one stays readable", () => {
    renderPicker({ currentFolderId: "f2", initialFolderId: "f2", movingId: "f1" });
    const reasons: Array<[string, string]> = [
      ["Tài chính", t("documents.home.move.reason_current")],
      ["Hợp đồng", t("documents.home.move.reason_self")],
    ];
    for (const [name, reason] of reasons) {
      const row = screen.getByRole("treeitem", { name });
      const text = within(row).getByText(reason);
      expect(text).toHaveAttribute("title", reason);
      expect(row).toHaveAccessibleDescription(reason);
    }
  });

  it("renders a tree with treeitems, marks the picked target with aria-selected, and submits it", () => {
    const props = renderPicker();
    const pickerTree = screen.getByRole("tree", { name: t("documents.home.move.picker_label") });
    expect(pickerTree).toBeInTheDocument();
    const folder = within(pickerTree).getByRole("treeitem", { name: "Hợp đồng" });
    expect(folder).toHaveAttribute("aria-selected", "false");
    fireEvent.click(folder);
    expect(folder).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.move.submit") }));
    expect(props.onSubmit).toHaveBeenCalledWith("f1");
  });

  it("cannot pick the current location (root or folder): shown with aria-disabled and reason, selecting does nothing", () => {
    // When current location is root (null)
    const rootProps = renderPicker({ currentFolderId: null, initialFolderId: null });
    const rootRow = screen.getByRole("treeitem", { name: t("documents.home.move.root") });
    expect(rootRow).toHaveAttribute("aria-disabled", "true");
    expect(rootRow).toHaveAttribute("aria-selected", "false");
    expect(rootRow).toHaveTextContent(t("documents.home.move.reason_current"));
    fireEvent.click(rootRow);
    fireEvent.keyDown(rootRow, { key: "Enter" });
    expect(rootRow).toHaveAttribute("aria-selected", "false");
    const submitBtn = screen.getByRole("button", { name: t("documents.home.move.submit") });
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submitBtn);
    expect(rootProps.onSubmit).not.toHaveBeenCalled();

    // When current location is a folder ("f1"), clicking it does nothing
    const folderProps = renderPicker({ currentFolderId: "f1", initialFolderId: "f1" });
    const folderRows = screen.getAllByRole("treeitem", { name: "Hợp đồng" });
    const currentFolderRow = folderRows[folderRows.length - 1]!;
    expect(currentFolderRow).toHaveAttribute("aria-disabled", "true");
    expect(currentFolderRow).toHaveAttribute("aria-selected", "false");
    expect(currentFolderRow).toHaveTextContent(t("documents.home.move.reason_current"));
    fireEvent.click(currentFolderRow);
    expect(currentFolderRow).toHaveAttribute("aria-selected", "false");
    expect(folderProps.onSubmit).not.toHaveBeenCalled();
  });

  it("keeps disabled rows (current location, own subtree, too-deep) focusable and exposes their reason in accessible description and visible text", () => {
    const props = renderPicker({
      currentFolderId: "f2",
      initialFolderId: "f2",
      movingId: "f1",
    });
    const currentRow = screen.getByRole("treeitem", { name: "Tài chính" });
    const selfRow = screen.getByRole("treeitem", { name: "Hợp đồng" });
    const subtreeRow = screen.getByRole("treeitem", { name: "Phụ lục" });

    for (const [row, name, reason] of [
      [currentRow, "Tài chính", t("documents.home.move.reason_current")],
      [selfRow, "Hợp đồng", t("documents.home.move.reason_self")],
      [subtreeRow, "Phụ lục", t("documents.home.move.reason_self")],
    ] as const) {
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).toHaveAccessibleName(name);
      expect(row).toHaveAccessibleDescription(reason);
      expect(row).toHaveTextContent(reason);
      row.focus();
      expect(document.activeElement).toBe(row);
      fireEvent.click(row);
      expect(row).toHaveAttribute("aria-selected", "false");
    }

    // Keyboard ArrowDown reaches disabled rows in order
    const rootRow = screen.getByRole("treeitem", { name: t("documents.home.move.root") });
    rootRow.focus();
    fireEvent.keyDown(rootRow, { key: "ArrowDown" });
    expect(document.activeElement).toBe(selfRow);
    fireEvent.keyDown(selfRow, { key: "ArrowDown" });
    expect(document.activeElement).toBe(subtreeRow);
    fireEvent.keyDown(subtreeRow, { key: "ArrowDown" });
    expect(document.activeElement).toBe(currentRow);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("allows picking Documents (gốc) root when moving an item out of a subfolder", () => {
    const props = renderPicker({
      currentFolderId: "f1",
      initialFolderId: "f1",
      movingId: "f1-sub",
    });
    const rootRow = screen.getByRole("treeitem", { name: t("documents.home.move.root") });
    expect(rootRow).not.toHaveAttribute("aria-disabled");
    fireEvent.click(rootRow);
    expect(rootRow).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.move.submit") }));
    expect(props.onSubmit).toHaveBeenCalledWith(null);
  });

  it("shows too-deep targets with aria-disabled and the localized TREE_MAX_LEVEL reason instead of hiding them", () => {
    const deepTree: DocumentTreeNode[] = [
      ...buildDeepChain(TREE_MAX_LEVEL),
      {
        id: "moving-branch",
        title: "Nhánh đang chuyển",
        kind: "folder",
        parent_id: null,
        position: 1,
        children: [
          { id: "moving-child", title: "Con của nhánh", kind: "folder", parent_id: "moving-branch", position: 0, children: [] },
        ],
      },
    ];
    const props = renderPicker({
      tree: deepTree,
      currentFolderId: null,
      initialFolderId: null,
      movingId: "moving-branch",
    });

    // moving-branch has subtreeHeight = 1, so level 18 (18 + 1 + 1 = 20 <= 20) is allowed,
    // while level 19 and level 20 exceed TREE_MAX_LEVEL (20) and are shown disabled with reason.
    const allowedRow = screen.getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 2}` });
    const tooDeep19 = screen.getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 1}` });
    const tooDeep20 = screen.getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL}` });
    const expectedReason = t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL });

    expect(allowedRow).not.toHaveAttribute("aria-disabled");
    for (const row of [tooDeep19, tooDeep20]) {
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).toHaveAccessibleDescription(expectedReason);
      expect(row).toHaveTextContent(expectedReason);
      row.focus();
      expect(document.activeElement).toBe(row);
      fireEvent.click(row);
      expect(row).toHaveAttribute("aria-selected", "false");
    }

    fireEvent.click(allowedRow);
    expect(allowedRow).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.move.submit") }));
    expect(props.onSubmit).toHaveBeenCalledWith(`lvl-${TREE_MAX_LEVEL - 2}`);
  });

  it("supports WAI-ARIA tree keyboard navigation (ArrowLeft/ArrowRight collapse/expand, Home/End, Enter/Space to select)", () => {
    const props = renderPicker();
    const f1Row = screen.getByRole("treeitem", { name: "Hợp đồng" });
    expect(f1Row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "Phụ lục" })).toBeInTheDocument();

    // ArrowLeft collapses an expanded parent folder
    f1Row.focus();
    fireEvent.keyDown(f1Row, { key: "ArrowLeft" });
    expect(f1Row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "Phụ lục" })).toBeNull();

    // ArrowRight expands it again, and a second ArrowRight enters its first child
    fireEvent.keyDown(f1Row, { key: "ArrowRight" });
    expect(f1Row).toHaveAttribute("aria-expanded", "true");
    const subRow = screen.getByRole("treeitem", { name: "Phụ lục" });
    fireEvent.keyDown(f1Row, { key: "ArrowRight" });
    expect(document.activeElement).toBe(subRow);

    // Enter selects the focused treeitem
    fireEvent.keyDown(subRow, { key: "Enter" });
    expect(subRow).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.move.submit") }));
    expect(props.onSubmit).toHaveBeenCalledWith("f1-sub");
  });

  it("ignores Space on an aria-disabled row (same as Enter) while keeping ArrowLeft/ArrowRight and the chevron for expand/collapse", () => {
    const props = renderPicker({
      currentFolderId: "f1",
      initialFolderId: "f1",
      movingId: "f1",
    });
    const f1Row = screen.getByRole("treeitem", { name: "Hợp đồng" });
    expect(f1Row).toHaveAttribute("aria-disabled", "true");
    expect(f1Row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "Phụ lục" })).toBeInTheDocument();

    // Space and Enter on a disabled parent row neither select nor collapse/expand it
    f1Row.focus();
    fireEvent.keyDown(f1Row, { key: " " });
    fireEvent.keyDown(f1Row, { key: "Enter" });
    expect(f1Row).toHaveAttribute("aria-selected", "false");
    expect(f1Row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "Phụ lục" })).toBeInTheDocument();

    // ArrowLeft and ArrowRight still collapse and expand the disabled branch
    fireEvent.keyDown(f1Row, { key: "ArrowLeft" });
    expect(f1Row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "Phụ lục" })).toBeNull();

    fireEvent.keyDown(f1Row, { key: "ArrowRight" });
    expect(f1Row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "Phụ lục" })).toBeInTheDocument();

    // Chevron button also collapses and expands without selecting
    fireEvent.click(within(f1Row).getByRole("button", { name: t("documents.tree.collapse", { title: "Hợp đồng" }) }));
    expect(f1Row).toHaveAttribute("aria-expanded", "false");
    expect(f1Row).toHaveAttribute("aria-selected", "false");
    fireEvent.click(within(f1Row).getByRole("button", { name: t("documents.tree.expand", { title: "Hợp đồng" }) }));
    expect(f1Row).toHaveAttribute("aria-expanded", "true");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("disables a folder at TREE_MAX_LEVEL with reason_too_deep and does not preselect it when saving a source (no movingId)", async () => {
    const deepTree = buildDeepChain(TREE_MAX_LEVEL);
    const maxFolderId = `lvl-${TREE_MAX_LEVEL}`;
    const parentFolderId = `lvl-${TREE_MAX_LEVEL - 1}`;
    const expectedReason = t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL });
    const baseProps: React.ComponentProps<typeof FolderPickerDialog> = {
      open: true,
      onOpenChange: vi.fn(),
      title: t("documents.home.save_source.title"),
      description: t("documents.home.save_source.description", { name: "Đề xuất.pdf" }),
      submitLabel: t("documents.home.save_source.submit"),
      pickerLabel: t("documents.home.save_source.picker_label"),
      rootLabel: t("documents.home.save_source.root"),
      tree: deepTree,
      initialFolderId: maxFolderId,
      pending: false,
      error: null,
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<FolderPickerDialog {...baseProps} />);

    const maxRow = screen.getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL}` });
    const allowedRow = screen.getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 1}` });
    const submitBtn = screen.getByRole("button", { name: t("documents.home.save_source.submit") });

    expect(maxRow).toHaveAttribute("aria-disabled", "true");
    expect(maxRow).toHaveAttribute("aria-selected", "false");
    expect(maxRow).toHaveAccessibleDescription(expectedReason);
    expect(maxRow).toHaveTextContent(expectedReason);
    expect(allowedRow).not.toHaveAttribute("aria-disabled");
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");

    // Reopening at level 20 also keeps it unselected and submit blocked
    rerender(<FolderPickerDialog {...baseProps} open={false} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(<FolderPickerDialog {...baseProps} open />);
    expect(await screen.findByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL}` })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("button", { name: t("documents.home.save_source.submit") })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    fireEvent.click(screen.getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 1}` }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.save_source.submit") }));
    expect(baseProps.onSubmit).toHaveBeenCalledWith(parentFolderId);
  });

  it("holds its buttons with aria-disabled while pending: they keep focus and do nothing", () => {
    const props = renderPicker({ pending: true });
    const submit = screen.getByRole("button", { name: t("documents.home.move.submit") });
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
    fireEvent.click(screen.getByRole("treeitem", { name: "Hợp đồng" }));
    expect(screen.getByRole("treeitem", { name: "Hợp đồng" })).toHaveAttribute("aria-selected", "true");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("submits the workspace root as null and names an untitled folder", () => {
    const props = renderPicker({
      tree: [{ id: "f2", title: "", kind: "folder", parent_id: null, position: 0, children: [] }],
      initialFolderId: "f2",
    });
    expect(screen.getByRole("treeitem", { name: t("documents.detail.untitled") })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("treeitem", { name: t("documents.home.move.root") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.move.submit") }));
    expect(props.onSubmit).toHaveBeenCalledWith(null);
  });

  it("starts from the initial folder again each time it opens", async () => {
    const props = {
      onOpenChange: vi.fn(),
      title: t("documents.home.move.picker_title"),
      description: "Chọn",
      submitLabel: t("documents.home.move.submit"),
      tree,
      pending: false,
      error: null,
      onSubmit: vi.fn(),
    };
    const { rerender } = render(<FolderPickerDialog {...props} open initialFolderId={null} />);
    fireEvent.click(screen.getByRole("treeitem", { name: "Hợp đồng" }));
    expect(screen.getByRole("treeitem", { name: "Hợp đồng" })).toHaveAttribute("aria-selected", "true");
    rerender(<FolderPickerDialog {...props} open={false} initialFolderId={null} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(<FolderPickerDialog {...props} open initialFolderId={null} />);
    expect(await screen.findByRole("treeitem", { name: "Hợp đồng" })).toHaveAttribute("aria-selected", "false");
  });
});

