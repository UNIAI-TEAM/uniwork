import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentTree } from "./document-tree";

// UNI-2055 A2: the sidebar tree refuses a workspace folder dropped into My
// Folder (no request) and asks before a folder leaves My Folder (W3).

const { t } = initI18n();
const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;

const dnd = vi.hoisted(() => ({
  onDragStart: undefined as ((event: unknown) => void) | undefined,
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: {
      children?: React.ReactNode;
      onDragStart?: (event: unknown) => void;
      onDragEnd?: (event: unknown) => void;
    }) => {
      dnd.onDragStart = props.onDragStart;
      dnd.onDragEnd = props.onDragEnd;
      return <>{props.children}</>;
    },
    DragOverlay: () => null,
    useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  };
});

function node(over: Record<string, unknown>): DocumentTreeNode {
  return { title: "Nút", kind: "folder", position: 0, visibility: "workspace", children: [], ...over } as DocumentTreeNode;
}

const forest: DocumentTreeNode[] = [
  node({
    id: "mf",
    title: "Thư mục của tôi",
    system_kind: "my_folder",
    visibility: "restricted",
    children: [
      node({ id: "mf-sub", title: "Riêng A", parent_id: "mf", visibility: "restricted" }),
      node({ id: "mf-page", title: "Ghi chú riêng", kind: "page", parent_id: "mf", visibility: "restricted" }),
    ],
  }),
  node({ id: "wf", title: "Hợp đồng", children: [node({ id: "wf-sub", title: "Phụ lục", parent_id: "wf" })] }),
  node({ id: "wf2", title: "Tài chính" }),
];

const moveDoc = (id: string) => ({ id, workspace_id: WS, kind: "folder", title: id, revision: "3" });
const posts = () => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST");

function dragStart(id: string) {
  act(() => {
    dnd.onDragStart?.({ active: { id: `doc:${id}` } });
  });
}

function dragEnd(id: string, targetId: string) {
  act(() => {
    dnd.onDragEnd?.({ active: { id: `doc:${id}` }, over: { data: { current: { id: targetId } } } });
  });
}

async function renderOpenTree() {
  render(wrap(<DocumentTree wsId={WS} />));
  const mf = await screen.findByRole("treeitem", { name: /Thư mục của tôi/ });
  fireEvent.keyDown(mf, { key: "ArrowRight" });
  await screen.findByRole("treeitem", { name: /Riêng A/ });
  fireEvent.keyDown(screen.getByRole("treeitem", { name: /Hợp đồng/ }), { key: "ArrowRight" });
  await screen.findByRole("treeitem", { name: /Phụ lục/ });
}

describe("DocumentTree: My Folder guards (UNI-2055 A2)", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (opts?.method === "POST") return Promise.resolve({ document: moveDoc("x") });
      return Promise.resolve({ document: moveDoc(path.split("/")[4] ?? "x") });
    });
  });

  it.each([
    ["My Folder itself", "mf"],
    ["a folder inside My Folder", "mf-sub"],
  ])("refuses a workspace folder dropped on %s without a request", async (_label, targetId) => {
    await renderOpenTree();
    const toastError = vi.spyOn(toast, "error");
    const before = requestMock.mock.calls.length;
    dragStart("wf");
    dragEnd("wf", targetId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestMock.mock.calls.length).toBe(before);
    expect(toastError).toHaveBeenCalledWith(t("documents.home.move.reason_workspace_folder"));
    toastError.mockRestore();
  });

  it("refuses a nested workspace folder dropped on My Folder too", async () => {
    await renderOpenTree();
    const toastError = vi.spyOn(toast, "error");
    const before = requestMock.mock.calls.length;
    dragStart("wf-sub");
    dragEnd("wf-sub", "mf");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestMock.mock.calls.length).toBe(before);
    expect(toastError).toHaveBeenCalledWith(t("documents.home.move.reason_workspace_folder"));
    toastError.mockRestore();
  });

  it("moves a page out of My Folder without a dialog: documents keep their access (W4)", async () => {
    await renderOpenTree();
    const toastError = vi.spyOn(toast, "error");
    dragStart("mf-page");
    dragEnd("mf-page", "wf2");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    toastError.mockRestore();
  });

  it("asks before a folder is dropped out of My Folder, and Cancel sends nothing", async () => {
    await renderOpenTree();
    const before = requestMock.mock.calls.length;
    dragStart("mf-sub");
    dragEnd("mf-sub", "wf2");
    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    expect(confirm).toHaveTextContent(t("documents.home.move.out_confirm.body"));
    expect(requestMock.mock.calls.length).toBe(before);
    fireEvent.click(within(confirm).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requestMock.mock.calls.length).toBe(before);
    expect(posts()).toHaveLength(0);
  });

  it("moves the folder once the confirm is accepted", async () => {
    await renderOpenTree();
    dragStart("mf-sub");
    dragEnd("mf-sub", "wf2");
    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    fireEvent.click(within(confirm).getByRole("button", { name: t("documents.home.move.out_confirm.confirm") }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe("/api/v1/documents/mf-sub/move");
    expect((posts()[0]![1] as { body: unknown }).body).toEqual({ parent_id: "wf2", revision: "3" });
  });

  it("asks for the keyboard outdent that takes a folder out of My Folder as well", async () => {
    await renderOpenTree();
    const before = requestMock.mock.calls.length;
    fireEvent.keyDown(screen.getByRole("treeitem", { name: /Riêng A/ }), { key: "ArrowLeft", ctrlKey: true });
    await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    expect(requestMock.mock.calls.length).toBe(before);
  });

  it("does not ask for a folder moved between workspace folders", async () => {
    await renderOpenTree();
    dragStart("wf-sub");
    dragEnd("wf-sub", "wf2");
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
