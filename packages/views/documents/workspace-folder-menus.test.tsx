import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentTree } from "./document-tree";
import { newFolderIsWorkspaceVisible } from "./document-tree-model";
import { DocumentTreeRowMenu, useTreeRowMenuDialogs } from "./document-tree-row-menu";
import { DocumentsSidebar } from "./documents-sidebar";
import { FolderNameDialog } from "./folder-name-dialog";
import type { DocumentSummaryRow } from "./library-rows";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";

// UNI-2055 A1: the tree row menu, the create-folder dialog note and the
// sidebar create for workspace folders (W1-W5).

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();
const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const note = () => t("documents.home.folders.create_workspace_note");

function node(over: Partial<DocumentTreeNode> & { id: string }): DocumentTreeNode {
  return { title: "Nút", kind: "folder", position: 0, visibility: "workspace", children: [], ...over };
}

const forest: DocumentTreeNode[] = [
  node({
    id: "mf",
    title: "Thư mục của tôi",
    system_kind: "my_folder",
    visibility: "restricted",
    children: [node({ id: "mf-sub", title: "Riêng A", parent_id: "mf", visibility: "restricted" })],
  }),
  node({ id: "wf", title: "Hợp đồng", children: [node({ id: "wf-sub", title: "Phụ lục", parent_id: "wf" })] }),
  node({ id: "wf2", title: "Tài chính" }),
];

const detail = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org1",
  workspace_id: WS,
  kind: "folder",
  title: id,
  visibility: "workspace",
  revision: "4",
  my_level: "manage",
  ...over,
});

function answer(opts: { role?: string; level?: string; post?: (path: string) => unknown; tree?: DocumentTreeNode[] } = {}) {
  requestMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === `/api/v1/workspaces/${WS}/me`) {
      return Promise.resolve({ membership: { user_id: "u1", role: opts.role ?? "member", source: "membership" } });
    }
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: opts.tree ?? forest });
    if (init?.method === "POST") return Promise.resolve(opts.post?.(path) ?? { document: detail("x") });
    if (path.startsWith("/api/v1/documents/")) {
      const id = path.split("/")[4]?.split("?")[0] ?? "x";
      return Promise.resolve({
        document: detail(id, { my_level: opts.level ?? "manage", visibility: id.startsWith("mf") ? "restricted" : "workspace" }),
      });
    }
    return Promise.resolve({ documents: [] });
  });
}

const posts = () => requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST");

beforeEach(() => {
  requestMock.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  resetAuthStoreForTests();
  setSessionUser({
    id: "u1",
    email: "an@example.com",
    display_name: "An",
    onboarded_at: "2026-08-25T00:00:00Z",
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  });
});

const wsFolderNode = node({ id: "wf", title: "Hợp đồng", parent_id: null });
const menuNames = () => screen.getAllByRole("menuitem").map((item) => item.textContent);

async function openRowMenu(n: DocumentTreeNode, myLevel: string) {
  render(wrap(<DocumentTreeRowMenu wsId={WS} node={n} myLevel={myLevel} />));
  fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: n.title }) }));
  await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") });
}

describe("tree row menu on a workspace folder (UNI-2055 W2/W3/W4)", () => {
  it("gives a member at view level New sub-folder only: no rename, move or delete", async () => {
    answer();
    await openRowMenu(wsFolderNode, "view");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeInTheDocument());
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
    expect(menuNames()).toContain(t("documents.tree.menu.new_subfolder"));
  });

  it("gives the creator or an admin (manage) every entry", async () => {
    answer();
    await openRowMenu(wsFolderNode, "manage");
    for (const key of ["new_subfolder", "rename", "move_to", "delete"]) {
      expect(await screen.findByRole("menuitem", { name: t(`documents.tree.menu.${key}`) })).toBeInTheDocument();
    }
  });

  it("gives a read-only workspace role no create entry either", async () => {
    answer({ role: "viewer" });
    await openRowMenu(wsFolderNode, "view");
    // Let the membership answer land before asserting the absence.
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WS}/me`));
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeNull();
  });

  it("does not offer a member at view level New sub-folder on a restricted folder", async () => {
    answer();
    await openRowMenu(node({ id: "mf-sub", title: "Riêng A", visibility: "restricted" }), "view");
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WS}/me`));
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") })).toBeNull();
  });
});

describe("tree row menu Move reuses the guarded row dialogs (UNI-2055 A2 helpers)", () => {
  async function openTree() {
    render(wrap(<DocumentTree wsId={WS} folders />));
    const mf = await screen.findByRole("treeitem", { name: /Thư mục của tôi/ });
    fireEvent.keyDown(mf, { key: "ArrowRight" });
    await screen.findByRole("treeitem", { name: /Riêng A/ });
  }

  it("disables My Folder as the target when a workspace folder is moved from its menu", async () => {
    answer();
    await openTree();
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /Hợp đồng/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const picker = await screen.findByRole("dialog");
    const mf = within(picker).getByRole("treeitem", { name: t("documents.home.my_folder.label") });
    expect(mf).toHaveAttribute("aria-disabled", "true");
    expect(mf).toHaveAccessibleDescription(t("documents.home.move.reason_workspace_folder"));
  });

  it("asks before a My Folder sub-folder moves out from its menu, and sends nothing until confirmed", async () => {
    answer();
    await openTree();
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /Riêng A/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const picker = await screen.findByRole("dialog");
    fireEvent.click(within(picker).getByRole("treeitem", { name: "Tài chính" }));
    fireEvent.click(within(picker).getByRole("button", { name: t("documents.home.move.submit") }));

    const confirm = await screen.findByRole("alertdialog", { name: t("documents.home.move.out_confirm.title") });
    expect(posts()).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(posts()).toHaveLength(0);
  });
});

describe("create-folder dialog note (UNI-2055 W1)", () => {
  const dialog = (over: Partial<React.ComponentProps<typeof FolderNameDialog>> = {}) =>
    render(wrap(<FolderNameDialog open onOpenChange={vi.fn()} mode="create" wsId={WS} {...over} />));

  it("shows the note under the name field when the folder will be seen by the workspace", () => {
    dialog({ workspaceNote: true });
    expect(screen.getByText(note())).toBeInTheDocument();
  });

  it("shows no note when the flag is off, and never in rename mode", () => {
    const first = dialog();
    expect(screen.queryByText(note())).toBeNull();
    first.unmount();
    dialog({ mode: "rename", folderId: "wf", initialName: "Hợp đồng", workspaceNote: true });
    expect(screen.queryByText(note())).toBeNull();
  });

  it("reads the note as the voice guide has it (vi)", () => {
    expect(note()).toBe("Tên thư mục sẽ hiện với mọi người trong workspace. Tài liệu bên trong vẫn chỉ mình bạn xem được cho tới khi bạn chia sẻ.");
  });
});

describe("create-folder note per caller (UNI-2055 W1)", () => {
  async function openTree() {
    render(wrap(<DocumentTree wsId={WS} />));
    const mf = await screen.findByRole("treeitem", { name: /Thư mục của tôi/ });
    fireEvent.keyDown(mf, { key: "ArrowRight" });
    await screen.findByRole("treeitem", { name: /Riêng A/ });
  }

  async function newSubfolderOf(name: RegExp) {
    fireEvent.contextMenu(screen.getByRole("treeitem", { name }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") }));
    return screen.findByRole("dialog");
  }

  it("notes a new folder under a workspace folder (tree menu)", async () => {
    answer();
    await openTree();
    const dialog = await newSubfolderOf(/Hợp đồng/);
    expect(within(dialog).getByText(note())).toBeInTheDocument();
  });

  it("falls back to the row's own data when the parent is not in the forest (tree menu hook)", async () => {
    answer();
    function Harness({ parent }: { parent: DocumentTreeNode }) {
      const { actions, dialogs } = useTreeRowMenuDialogs({ wsId: WS, tree: [], currentId: null });
      return (
        <>
          <button type="button" onClick={() => actions.onNewSubfolder(parent)}>
            go
          </button>
          {dialogs}
        </>
      );
    }
    const open = async (parent: DocumentTreeNode) => {
      render(wrap(<Harness parent={parent} />));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      return screen.findByRole("dialog");
    };

    const first = await open(node({ id: "lost", title: "Chưa tải" }));
    expect(within(first).getByText(note())).toBeInTheDocument();
    cleanup();

    const second = await open(node({ id: "lost-mf", title: "Thư mục của tôi", system_kind: "my_folder", visibility: "restricted" }));
    expect(within(second).queryByText(note())).toBeNull();
  });

  it("falls back to the row's own data for a list row whose folder is not in the forest", async () => {
    answer();
    const row = (over: Partial<DocumentSummaryRow>): DocumentSummaryRow => ({
      id: "lost-row",
      organization_id: "org1",
      workspace_id: WS,
      kind: "folder",
      title: "Chưa tải",
      visibility: "workspace",
      revision: "1",
      current_version: 1,
      position: 0,
      my_level: "view",
      created_by: "",
      created_by_kind: "human",
      updated_by: "u1",
      updated_by_kind: "human",
      created_at: "",
      updated_at: "2026-09-28T03:00:00Z",
      ...over,
    });
    function Harness({ parent }: { parent: DocumentSummaryRow }) {
      const { onNewSubfolder, dialogs } = useLibraryRowDialogs({ wsId: WS, tree: [], folderId: null });
      return (
        <>
          <button type="button" onClick={() => onNewSubfolder(parent)}>
            go
          </button>
          {dialogs}
        </>
      );
    }
    const open = async (parent: DocumentSummaryRow) => {
      render(wrap(<Harness parent={parent} />));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      return screen.findByRole("dialog");
    };

    expect(within(await open(row({}))).getByText(note())).toBeInTheDocument();
    cleanup();
    expect(within(await open(row({ system_kind: "my_folder", visibility: "restricted" }))).queryByText(note())).toBeNull();
  });

  it("judges the header and empty-state New folder from the open folder's row when the tree lacks it (RFW-13)", async () => {
    answer();
    const openRow = (over: Partial<DocumentSummaryRow>) =>
      ({ id: "lost-open", workspace_id: WS, kind: "folder", title: "Chưa tải", visibility: "workspace", revision: "1", ...over }) as DocumentSummaryRow;
    function Harness({ folderRow }: { folderRow: DocumentSummaryRow | null }) {
      const { onCreateFolder, dialogs } = useLibraryRowDialogs({ wsId: WS, tree: [], folderId: "lost-open", folderTitle: "Chưa tải", folderRow });
      return (
        <>
          <button type="button" onClick={() => onCreateFolder()}>
            go
          </button>
          {dialogs}
        </>
      );
    }
    const open = async (folderRow: DocumentSummaryRow | null) => {
      render(wrap(<Harness folderRow={folderRow} />));
      fireEvent.click(screen.getByRole("button", { name: "go" }));
      return screen.findByRole("dialog");
    };

    expect(within(await open(openRow({}))).getByText(note())).toBeInTheDocument();
    cleanup();
    expect(within(await open(openRow({ system_kind: "my_folder", visibility: "restricted" }))).queryByText(note())).toBeNull();
    cleanup();
    expect(within(await open(null)).queryByText(note())).toBeNull();
  });

  describe("a tree shaped like the real server's: no visibility on any node (TV-01)", () => {
    const bare = (id: string, over: Partial<DocumentTreeNode> = {}): DocumentTreeNode => ({
      id, title: id, kind: "folder", position: 0, children: [], ...over,
    });
    const real: DocumentTreeNode[] = [
      bare("mf", { system_kind: "my_folder", children: [bare("mf-sub", { parent_id: "mf", children: [bare("mf-deep", { parent_id: "mf-sub" })] })] }),
      bare("wf", { children: [bare("wf-sub", { parent_id: "wf", children: [bare("wf-deep", { parent_id: "wf-sub" })] })] }),
      bare("page", { kind: "page" }),
    ];

    it("decides by ancestry: a workspace folder has no My Folder above it", () => {
      for (const id of ["wf", "wf-sub", "wf-deep"]) expect(newFolderIsWorkspaceVisible(real, id)).toBe(true);
      for (const id of ["mf", "mf-sub", "mf-deep", "page", "missing"]) expect(newFolderIsWorkspaceVisible(real, id)).toBe(false);
      expect(newFolderIsWorkspaceVisible(real, null)).toBe(true);
    });

    it("lets an explicit visibility win over ancestry", () => {
      const tree = [bare("wf", { children: [bare("wf-r", { parent_id: "wf", visibility: "restricted" })] })];
      expect(newFolderIsWorkspaceVisible(tree, "wf-r")).toBe(false);
      expect(newFolderIsWorkspaceVisible([], "lost", { kind: "folder", visibility: "workspace" })).toBe(true);
    });

    it("notes the create under a workspace sub-folder and under none of My Folder's (tree menu)", async () => {
      answer({ tree: real });
      render(wrap(<DocumentTree wsId={WS} />));
      fireEvent.keyDown(await screen.findByRole("treeitem", { name: /Thư mục của tôi/ }), { key: "ArrowRight" });
      fireEvent.keyDown(await screen.findByRole("treeitem", { name: /^wf(\s|$)/ }), { key: "ArrowRight" });
      const create = async (name: RegExp) => {
        fireEvent.contextMenu(await screen.findByRole("treeitem", { name }));
        fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") }));
        return screen.findByRole("dialog");
      };
      const inWorkspace = await create(/^wf-sub/);
      expect(within(inWorkspace).getByText(note())).toBeInTheDocument();
      fireEvent.keyDown(inWorkspace, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(within(await create(/^mf-sub/)).queryByText(note())).toBeNull();
    });
  });

  it("notes nothing for a missing parent that is My Folder or not a folder (tree menu)", () => {
    const parents: Array<Partial<DocumentTreeNode>> = [
      { system_kind: "my_folder", visibility: "restricted" },
      { visibility: "restricted" },
      { kind: "page" },
    ];
    for (const over of parents) {
      const row = node({ id: "lost", ...over });
      expect(newFolderIsWorkspaceVisible([], "lost", row)).toBe(false);
    }
    expect(newFolderIsWorkspaceVisible([], "lost", node({ id: "lost" }))).toBe(true);
    expect(newFolderIsWorkspaceVisible([], "lost")).toBe(false);
    expect(newFolderIsWorkspaceVisible([], null)).toBe(true);
  });

  it("notes nothing under My Folder or under a folder inside it (tree menu)", async () => {
    answer();
    await openTree();
    const first = await newSubfolderOf(/Thư mục của tôi/);
    expect(within(first).queryByText(note())).toBeNull();
    fireEvent.keyDown(first, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const second = await newSubfolderOf(/Riêng A/);
    expect(within(second).queryByText(note())).toBeNull();
  });

  it("notes the sidebar's workspace-root create", async () => {
    answer();
    render(
      wrap(
        <DocumentsSidebar
          wsId={WS}
          view={{ kind: "home" }}
          folderId={null}
          canCreate
          starredCount={0}
          sourcesAvailable={false}
          onView={vi.fn()}
          onFolder={vi.fn()}
          onNewFolder={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.folders.new") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(note())).toBeInTheDocument();
  });
});

describe("create a sub-folder with a taken name (UNI-2055 W5)", () => {
  it("toasts the server's suffixed title, not the typed one, and sends the typed name", async () => {
    answer({ post: () => ({ document: detail("wf-new", { title: "Phụ lục (1)", parent_id: "wf" }) }) });
    render(wrap(<DocumentTree wsId={WS} />));
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: /Hợp đồng/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.new_subfolder") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Phụ lục" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.home.folders.toast.created", { title: "Phụ lục (1)" })),
    );
    expect((posts()[0]![1] as { body: { title: string; parent_id: string } }).body).toEqual({ kind: "folder", title: "Phụ lục", parent_id: "wf" });
  });

  it("hands the server's id and title to onSuccess", async () => {
    answer({ post: () => ({ document: detail("fo9", { title: "Báo cáo (1)" }) }) });
    const onSuccess = vi.fn();
    render(wrap(<FolderNameDialog open onOpenChange={vi.fn()} mode="create" wsId={WS} initialName="Báo cáo" onSuccess={onSuccess} />));
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.folders.create_submit") }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: "fo9", title: "Báo cáo (1)" }));
  });
});
