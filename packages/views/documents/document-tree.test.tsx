import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { wrap } from "../test/api-mock";
import { requestMock } from "../test/api-mock";
import {
  DocumentTree,
  flattenTree,
  loadMoveRevision,
  moveRefused,
  subtreeIds,
} from "./document-tree";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;

// dnd-kit's context is replaced so a test can drive the drag handlers directly;
// its hooks keep the rows rendering (they do not need real sensors in jsdom).
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

function node(over: Record<string, unknown> = {}): DocumentTreeNode {
  return { id: "t1", title: "Nút", kind: "page", position: 0, children: [], ...over } as DocumentTreeNode;
}

function documentRow(over: Record<string, unknown> = {}) {
  return { id: "root1", workspace_id: WS, kind: "page", title: "Nhóm", revision: "3", ...over };
}

const forest: DocumentTreeNode[] = [
  node({
    id: "root1",
    title: "Nhóm",
    children: [node({ id: "child1", title: "Trang con", parent_id: "root1" })],
  }),
  node({ id: "other1", title: "Đích" }),
];

function renderTree(onOpen = vi.fn()) {
  return render(wrap(<DocumentTree wsId={WS} onOpen={onOpen} />));
}

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

beforeEach(() => {
  requestMock.mockReset();
});

describe("document tree helpers", () => {
  it("flattens only the expanded branches, depth first", () => {
    expect(flattenTree(forest, new Set()).map((row) => row.node.id)).toEqual(["root1", "other1"]);
    expect(flattenTree(forest, new Set(["root1"])).map((row) => row.node.id)).toEqual([
      "root1",
      "child1",
      "other1",
    ]);
    const rows = flattenTree(forest, new Set(["root1"]));
    expect(rows[1]?.depth).toBe(1);
    expect(rows[1]?.parentId).toBe("root1");
  });

  it("collects a subtree and refuses a move into it", () => {
    expect(subtreeIds(forest, "root1")).toEqual(new Set(["root1", "child1"]));
    expect(subtreeIds(forest, "missing")).toEqual(new Set());
    expect(moveRefused(forest, "root1", "child1")).toBe(true);
    expect(moveRefused(forest, "root1", "root1")).toBe(true);
    expect(moveRefused(forest, "root1", "other1")).toBe(false);
  });
});

describe("DocumentTree", () => {
  it("loads the forest, expands a branch and opens a document", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      return Promise.resolve({});
    });
    renderTree(onOpen);

    // Loading first: skeleton rows, no invented nodes.
    expect(screen.getByLabelText(t("documents.tree.loading"))).toHaveAttribute("aria-busy", "true");

    const root = await screen.findByRole("treeitem", { name: /Nhóm/ });
    expect(root).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Trang con")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: t("documents.tree.expand", { title: "Nhóm" }) }),
    );
    const child = await screen.findByRole("treeitem", { name: /Trang con/ });
    expect(child).toHaveAttribute("aria-level", "2");

    fireEvent.click(child);
    expect(onOpen).toHaveBeenCalledWith("child1");
  });

  it("walks and toggles the tree with the keyboard", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: forest }) : Promise.resolve({}),
    );
    renderTree(onOpen);

    const root = await screen.findByRole("treeitem", { name: /Nhóm/ });
    const other = screen.getByRole("treeitem", { name: /Đích/ });

    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(other).toHaveFocus();
    fireEvent.keyDown(other, { key: "ArrowUp" });
    expect(root).toHaveFocus();

    // → expands a collapsed branch, then enters its first child.
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(root).toHaveAttribute("aria-expanded", "true");
    const child = await screen.findByRole("treeitem", { name: /Trang con/ });
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(child).toHaveFocus();

    // ← goes to the parent, then collapses it.
    fireEvent.keyDown(child, { key: "ArrowLeft" });
    expect(root).toHaveFocus();
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(root).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Trang con")).toBeNull();

    // Space toggles like the chevron; Enter opens.
    fireEvent.keyDown(root, { key: " " });
    expect(root).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(root, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("root1");

    // Home / End stay inside the visible rows.
    fireEvent.keyDown(root, { key: "End" });
    expect(screen.getByRole("treeitem", { name: /Đích/ })).toHaveFocus();
    fireEvent.keyDown(other, { key: "Home" });
    expect(root).toHaveFocus();
  });

  it("says it is empty instead of drawing rows the server did not send", async () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: [] }) : Promise.resolve({}),
    );
    renderTree();

    expect(await screen.findByText(t("documents.tree.empty"))).toBeInTheDocument();
    expect(screen.queryAllByRole("treeitem")).toHaveLength(0);
  });

  it("offers a retry when the branch cannot be read", async () => {
    let calls = 0;
    requestMock.mockImplementation((path: string) => {
      if (!path.startsWith(TREE_URL)) return Promise.resolve({});
      calls += 1;
      return calls === 1
        ? Promise.reject(new ApiError("boom", "internal", 500))
        : Promise.resolve({ documents: forest });
    });
    renderTree();

    expect(await screen.findByText(t("documents.tree.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.tree.retry") }));
    expect(await screen.findByRole("treeitem", { name: /Nhóm/ })).toBeInTheDocument();
  });

  it("waits for the server before a move changes the tree", async () => {
    const moved: DocumentTreeNode[] = [
      node({ id: "other1", title: "Đích", children: [node({ id: "root1", title: "Nhóm", parent_id: "other1" })] }),
    ];
    let treeCalls = 0;
    let resolveMove!: (value: unknown) => void;
    const bodies: unknown[] = [];
    requestMock.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
      if (path.startsWith(TREE_URL)) {
        treeCalls += 1;
        return Promise.resolve({ documents: treeCalls === 1 ? forest : moved });
      }
      if (path === "/api/v1/documents/root1" && !opts?.method) {
        return Promise.resolve({ document: documentRow() });
      }
      if (path === "/api/v1/documents/root1/move" && opts?.method === "POST") {
        bodies.push(opts.body);
        return new Promise((resolve) => {
          resolveMove = resolve;
        });
      }
      return Promise.resolve({});
    });
    renderTree();

    const root = await screen.findByRole("treeitem", { name: /Nhóm/ });
    expect(root).toHaveAttribute("aria-level", "1");

    dragStart("root1");
    dragEnd("root1", "other1");

    await waitFor(() => expect(bodies).toHaveLength(1));
    // The revision came from the server, not from the tree payload.
    expect(bodies[0]).toEqual({ parent_id: "other1", revision: "3" });
    // No optimistic move: the row is still a root while the write is in flight.
    expect(screen.getByRole("treeitem", { name: /Nhóm/ })).toHaveAttribute("aria-level", "1");

    resolveMove({ document: documentRow({ parent_id: "other1" }) });

    await waitFor(() =>
      expect(screen.getByRole("treeitem", { name: /Nhóm/ })).toHaveAttribute("aria-level", "2"),
    );
  });

  it("refuses a move into the dragged node's own subtree without a request", async () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: forest }) : Promise.resolve({}),
    );
    renderTree();
    await screen.findByRole("treeitem", { name: /Nhóm/ });

    const before = requestMock.mock.calls.length;
    dragStart("root1");
    dragEnd("root1", "child1");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestMock.mock.calls.length).toBe(before);
    expect(screen.getByRole("treeitem", { name: /Nhóm/ })).toHaveAttribute("aria-level", "1");
  });

  it("keeps every position when the server refuses the move", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: forest });
      if (path === "/api/v1/documents/root1" && !opts?.method) {
        return Promise.resolve({ document: documentRow() });
      }
      if (path === "/api/v1/documents/root1/move" && opts?.method === "POST") {
        return Promise.reject(new ApiError("cycle", "document_cycle", 422));
      }
      return Promise.resolve({});
    });
    renderTree();
    await screen.findByRole("treeitem", { name: /Nhóm/ });

    dragStart("root1");
    dragEnd("root1", "other1");

    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(([path]) => path === "/api/v1/documents/root1/move"),
      ).toBe(true),
    );
    // The refused move left the tree exactly where it was.
    expect(screen.getByRole("treeitem", { name: /Nhóm/ })).toHaveAttribute("aria-level", "1");
    expect(screen.getByRole("treeitem", { name: /Nhóm/ })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("loadMoveRevision", () => {
  it("reads the working copy fresh and refuses an unverifiable one", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    requestMock.mockResolvedValue({ document: documentRow() });
    await expect(loadMoveRevision(queryClient, WS, "root1")).resolves.toBe("3");

    requestMock.mockResolvedValue({ document: null });
    await expect(loadMoveRevision(queryClient, WS, "root1")).resolves.toBeNull();

    requestMock.mockResolvedValue({});
    await expect(loadMoveRevision(queryClient, WS, "root1")).resolves.toBeNull();
  });
});
