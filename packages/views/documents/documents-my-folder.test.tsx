import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { DocumentsPageView } from "./documents-page-view";
import { DocumentActionsMenu } from "./document-actions-menu";
import { documentErrorMessage } from "./document-error-message";
import { DocumentPageHeader } from "./document-page-header";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { libraryLadder } from "./library-columns";
import { documentRow } from "./library-rows";

// MYFOLDER-W1 (UNI-1850, SAVE-01 web part 1): the Documents sub-nav row
// "Thư mục của tôi" ensures and opens the caller's My Folder; a create from
// Home with no folder open lands in it (destination, never parent_id); the
// folder row itself has no Rename / Share / Move / Archive.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));


const dnd = vi.hoisted(() => ({
  onDragStart: undefined as ((event: unknown) => void) | undefined,
  onDragEnd: undefined as ((event: unknown) => void) | undefined,
  disabledById: new Map<string, boolean>(),
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
    useDraggable: (opts: { id: string; disabled?: boolean }) => {
      dnd.disabledById.set(opts.id, Boolean(opts.disabled));
      return { attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false };
    },
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  };
});
const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const MY_FOLDER_URL = `${LIST_BASE}/my-folder`;

const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const label = () => t("documents.home.my_folder.label");

function summary(over: Record<string, unknown> = {}) {
  return { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch Q4", revision: "1", my_level: "manage", updated_at: "2026-09-28T03:00:00Z", ...over };
}

function file(id: string, title: string, over: Record<string, unknown> = {}) {
  return summary({
    id,
    kind: "file",
    title,
    organization_id: "org1",
    current_version: 1,
    my_level: "edit",
    file: { file_id: `file-${id}`, version_id: "v1", version: 1, filename: title, mime_type: "application/octet-stream", size_bytes: 5, checksum_sha256: "a".repeat(64) },
    ...over,
  });
}

/** The server's stored row: titled "My Folder" in English whatever the locale. */
function myFolderDoc(over: Record<string, unknown> = {}) {
  return summary({ id: "mf1", kind: "folder", title: "My Folder", system_kind: "my_folder", visibility: "restricted", my_level: "manage", breadcrumbs: [], ...over });
}

function treeNode(over: Record<string, unknown> = {}) {
  return { id: "t1", title: "Nhóm", kind: "page", position: 0, children: [], ...over };
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  detail?: (id: string) => unknown;
  post?: (path: string) => unknown;
  upload?: () => unknown;
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    const run = (fn: () => unknown) => {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    if (path.startsWith(TREE_URL)) return run(() => ({ documents: routes.tree?.() ?? [] }));
    if (path === `${LIST_BASE}/files`) return run(() => routes.upload?.() ?? {});
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") return run(() => ({ items: [], next_cursor: null }));
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      return run(() => {
        const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
        return doc ? { document: doc } : {};
      });
    }
    if (path.startsWith(LIST_BASE)) return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: null }));
    return Promise.resolve({});
  });
}

function renderView(onOpen: (id: string) => void = vi.fn(), initialUrl?: string) {
  const nav = fakeNav(initialUrl);
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={sessionUser}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={onOpen} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      nav,
    ),
  );
  return nav;
}

const posts = (path: string) =>
  requestMock.mock.calls.filter(([p, o]) => p === path && (o as { method?: string } | undefined)?.method === "POST");
const bodyOf = (call: unknown[] | undefined) => (call?.[1] as { body?: unknown } | undefined)?.body;
const pill = async (type: string) => {
  const strip = await screen.findByRole("region", { name: t("documents.home.quick_create.label") });
  return within(strip).getByRole("button", { name: new RegExp(t(`documents.home.create.${type}.chip`)) });
};

beforeEach(() => {
  requestMock.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  dnd.disabledById.clear();
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

describe("My Folder sub-nav row", () => {
  it("stands first under Thư mục until the folder exists, ensures it once, then the tree row takes its place", async () => {
    let created = false;
    route({
      tree: () => (created ? [treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder" })] : []),
      post: (path) => {
        if (path !== MY_FOLDER_URL) return {};
        created = true;
        return { document: myFolderDoc() };
      },
      detail: (id) => (id === "mf1" ? myFolderDoc() : null),
    });
    const nav = renderView();
    const sidebar = await screen.findByRole("navigation", { name: t("documents.home.sidebar.label") });
    // Not among the collections: the row after Home is Recent.
    const home = within(sidebar).getByRole("button", { name: t("documents.home.sidebar.home") });
    expect(home.nextElementSibling).toBe(within(sidebar).getByRole("button", { name: t("documents.home.sidebar.recent") }));
    const row = within(sidebar).getByRole("button", { name: label() });

    fireEvent.click(row);
    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("mf1"));
    expect(posts(MY_FOLDER_URL)).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: label() })).toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveTextContent("My Folder");

    // Once it exists, the tree row is the only My Folder entry and it is the current one.
    const treeRow = await within(sidebar).findByRole("treeitem", { name: new RegExp(label()) });
    expect(within(sidebar).queryByRole("button", { name: label() })).toBeNull();
    expect(treeRow).toHaveAttribute("aria-current", "true");
    expect(posts(MY_FOLDER_URL)).toHaveLength(1);
  });

  it("shows My Folder once, as a tree row with the lock glyph and its i18n label, and opens it with no ensure", async () => {
    route({
      tree: () => [treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder" })],
      detail: () => myFolderDoc(),
    });
    const nav = renderView();
    // Tree row: the stored English title never shows.
    const treeRow = await screen.findByRole("treeitem", { name: new RegExp(label()) });
    expect(screen.queryByText("My Folder")).toBeNull();
    expect(treeRow.querySelector("svg.lucide-folder-lock")).not.toBeNull();
    const sidebar = screen.getByRole("navigation", { name: t("documents.home.sidebar.label") });
    expect(within(sidebar).queryByRole("button", { name: label() })).toBeNull();
    fireEvent.click(treeRow);
    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("mf1"));
    expect(posts(MY_FOLDER_URL)).toHaveLength(0);
  });

  it("shows one message when the ensure fails and does not call it again by itself", async () => {
    route({
      post: (path) => {
        if (path === MY_FOLDER_URL) throw new ApiError("boom", "internal", 500);
        return {};
      },
    });
    const nav = renderView();
    fireEvent.click(await screen.findByRole("button", { name: label() }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(posts(MY_FOLDER_URL)).toHaveLength(1);
    expect(toast.error).toHaveBeenCalledWith(t("documents.home.my_folder.open_failed"));
    expect(nav.searchParams.get("folder")).toBeNull();
  });
});

describe("creates from Documents Home", () => {
  it("sends destination my_folder and no parent_id for a page and for a blank file", async () => {
    route({ list: () => [], post: () => ({ document: file("n1", "Văn bản.docx") }) });
    renderView();

    fireEvent.click(await pill("page"));
    await waitFor(() => expect(posts(LIST_BASE)).toHaveLength(1));
    expect(bodyOf(posts(LIST_BASE)[0])).toEqual({ title: t("documents.page.new_page"), destination: "my_folder" });

    fireEvent.click(await pill("docx"));
    await waitFor(() => expect(posts(`${LIST_BASE}/files/blank`)).toHaveLength(1));
    expect(bodyOf(posts(`${LIST_BASE}/files/blank`)[0])).toEqual({
      format: "docx",
      title: t("documents.home.default_names.docx"),
      destination: "my_folder",
    });
  });

  it("uploads and drops into My Folder with no parent_id", async () => {
    route({ list: () => [], upload: () => ({ document: file("d2", "note.txt") }) });
    renderView(vi.fn());
    expect(await screen.findByText(t("documents.home.quick_create.hint_root"))).toHaveTextContent(/Thư mục của tôi/);
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
    expect(await screen.findByText(t("documents.upload.description"))).toHaveTextContent(/Thư mục của tôi/);
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));
    await waitFor(() => expect(posts(`${LIST_BASE}/files`)).toHaveLength(1));
    const uploaded = bodyOf(posts(`${LIST_BASE}/files`)[0]) as FormData;
    expect(uploaded.get("destination")).toBe("my_folder");
    expect(uploaded.has("parent_id")).toBe(false);

    const zone = await screen.findByRole("region", { name: t("documents.page.title") });
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [new File(["x"], "drop.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(posts(`${LIST_BASE}/files`)).toHaveLength(2));
    const dropped = bodyOf(posts(`${LIST_BASE}/files`)[1]) as FormData;
    expect(dropped.get("destination")).toBe("my_folder");
    expect(dropped.has("parent_id")).toBe(false);
  });

  it("keeps parent_id and sends no destination inside an open folder", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [],
      detail: () => summary({ id: "fo1", kind: "folder", title: "Dự án CCB", revision: "3", breadcrumbs: [] }),
      post: () => ({ document: file("n2", "Bảng.xlsx") }),
      upload: () => ({ document: file("d3", "note.txt") }),
    });
    renderView();
    fireEvent.click(await screen.findByRole("treeitem", { name: /Dự án CCB/ }));
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.xlsx.menu")) }));
    await waitFor(() => expect(posts(`${LIST_BASE}/files/blank`)).toHaveLength(1));
    expect(bodyOf(posts(`${LIST_BASE}/files/blank`)[0])).toEqual({
      format: "xlsx",
      title: t("documents.home.default_names.xlsx"),
      parent_id: "fo1",
    });

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.create.upload.button") }));
    expect(await screen.findByText("Tệp trở thành tài liệu mới trong thư mục này.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.cancel") }));

    const zone = screen.getByRole("region", { name: t("documents.page.title") });
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [new File(["x"], "drop.txt", { type: "text/plain" })] } });
    await waitFor(() => expect(posts(`${LIST_BASE}/files`)).toHaveLength(1));
    const dropped = bodyOf(posts(`${LIST_BASE}/files`)[0]) as FormData;
    expect(dropped.get("parent_id")).toBe("fo1");
    expect(dropped.has("destination")).toBe(false);
  });
});

describe("guards on the My Folder row", () => {
  const cardMenu = async (title: string) => {
    const section = await screen.findByRole("region", { name: /^Thư mục [0-9]+$/ });
    fireEvent.click(await within(section).findByRole("button", { name: t("documents.home.row.menu", { title }) }));
  };

  it("orders My Folder first in the tree root and Home folder cards, offers no Rename, Move or Delete on its card, and keeps them on an ordinary folder", async () => {
    route({
      tree: () => [
        treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder", position: 0 }),
        treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder", position: 1 }),
      ],
      list: () => [summary({ id: "fo1", kind: "folder", title: "Dự án CCB" }), myFolderDoc()],
    });
    renderView();

    const treeItems = await screen.findAllByRole("treeitem");
    expect(treeItems[0]).toHaveTextContent(label());
    expect(treeItems[1]).toHaveTextContent("Dự án CCB");
    const foldersSection = await screen.findByRole("region", { name: /^Thư mục [0-9]+$/ });
    const cardItems = within(foldersSection).getAllByRole("listitem");
    expect(cardItems[0]).toHaveTextContent(label());
    expect(cardItems[1]).toHaveTextContent("Dự án CCB");

    await cardMenu(label());
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_folder") })).toBeInTheDocument();
    for (const key of ["documents.home.row.rename", "documents.tree.menu.move_to", "documents.tree.menu.delete"]) {
      expect(screen.queryByRole("menuitem", { name: t(key) })).toBeNull();
    }
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await cardMenu("Dự án CCB");
    for (const key of ["documents.home.row.rename", "documents.tree.menu.move_to", "documents.tree.menu.delete"]) {
      expect(await screen.findByRole("menuitem", { name: t(key) })).toBeInTheDocument();
    }
  });

  it("offers no Rename, Move or Delete in the tree row menu, and refuses drag and keyboard move of the row", async () => {
    route({
      tree: () => [
        treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder" }),
        treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder", position: 1 }),
      ],
      detail: (id) => (id === "mf1" ? myFolderDoc() : summary({ id, kind: "folder", title: "Dự án CCB" })),
    });
    renderView();

    const mine = await screen.findByRole("treeitem", { name: new RegExp(label()) });
    expect(dnd.disabledById.get("doc:mf1")).toBe(true);
    expect(dnd.disabledById.get("doc:fo1")).toBe(false);
    act(() => {
      dnd.onDragStart?.({ active: { id: "doc:mf1" } });
      dnd.onDragEnd?.({ active: { id: "doc:mf1" }, over: { data: { current: { id: "fo1" } } } });
    });
    fireEvent.keyDown(mine, { key: "ArrowDown", ctrlKey: true });
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([, o]) => (o as { method?: string } | undefined)?.method === "POST" || (o as { method?: string } | undefined)?.method === "PATCH")).toBe(false),
    );

    fireEvent.click(within(mine).getByRole("button", { name: t("documents.home.row.menu", { title: label() }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.open") })).toBeInTheDocument();
    for (const key of ["documents.tree.menu.rename", "documents.tree.menu.move_to", "documents.tree.menu.delete"]) {
      expect(screen.queryByRole("menuitem", { name: t(key) })).toBeNull();
    }
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    const ordinary = await screen.findByRole("treeitem", { name: /Dự án CCB/ });
    fireEvent.click(within(ordinary).getByRole("button", { name: t("documents.home.row.menu", { title: "Dự án CCB" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.rename") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeInTheDocument();
  });

  it("has no rename pencil and no Rename / Move / Delete in the open folder's header", async () => {
    route({
      tree: () => [treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder" })],
      list: () => [],
      detail: () => myFolderDoc(),
    });
    renderView(vi.fn(), `/acme/doi/documents?folder=mf1`);

    const heading = await screen.findByRole("heading", { level: 1, name: label() });
    expect(heading).toHaveTextContent(label());
    expect(within(heading).queryByRole("button")).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).queryByRole("button", { name: t("documents.home.folders.rename") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.folder.menu") }));
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.new_subfolder") })).toBeInTheDocument();
    for (const key of ["documents.home.row.rename", "documents.tree.menu.move_to", "documents.tree.menu.delete"]) {
      expect(screen.queryByRole("menuitem", { name: t(key) })).toBeNull();
    }
  });

  it("offers no Rename, Move or Delete on a My Folder library table row, and keeps them on an ordinary folder row", async () => {
    const rowHandlers: LibraryRowHandlers = {
      onOpen: vi.fn(),
      onFolder: vi.fn(),
      onGoToSource: vi.fn(),
      onDownloadSource: vi.fn(),
      onSaveSource: vi.fn(),
      onNewSubfolder: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onArchive: vi.fn(),
      isStarred: () => false,
      personName: () => "An",
    };
    const { unmount } = render(
      <table>
        <tbody>
          <LibraryRowView
            row={documentRow(myFolderDoc() as unknown as Parameters<typeof documentRow>[0])}
            handlers={rowHandlers}
            ladder={libraryLadder()}
          />
        </tbody>
      </table>,
    );
    expect(screen.getByText(label())).toBeInTheDocument();
    expect(screen.queryByText("My Folder")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: label() }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_folder") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.new_subfolder") })).toBeInTheDocument();
    for (const key of ["documents.home.row.rename", "documents.tree.menu.move_to", "documents.tree.menu.delete"]) {
      expect(screen.queryByRole("menuitem", { name: t(key) })).toBeNull();
    }
    unmount();

    render(
      <table>
        <tbody>
          <LibraryRowView
            row={documentRow(summary({ id: "fo1", kind: "folder", title: "Dự án CCB" }) as unknown as Parameters<typeof documentRow>[0])}
            handlers={rowHandlers}
            ladder={libraryLadder()}
          />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.row.menu", { title: "Dự án CCB" }) }));
    for (const key of ["documents.home.row.rename", "documents.tree.menu.move_to", "documents.tree.menu.delete"]) {
      expect(await screen.findByRole("menuitem", { name: t(key) })).toBeInTheDocument();
    }
  });

  it("hides Share and Move to trash on the My Folder detail actions menu and keeps the title read-only", async () => {
    const mf = myFolderDoc() as unknown as Parameters<typeof DocumentActionsMenu>[0]["doc"];
    const { unmount } = render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={sessionUser}>
          <DocumentPageHeader
            wsId={WS}
            doc={mf}
            editable
            onTitleChange={vi.fn()}
            onFocusBody={vi.fn()}
          />
          <DocumentActionsMenu wsId={WS} doc={mf} />
        </WorkspaceProvider>,
      ),
    );
    expect(screen.queryByRole("textbox", { name: t("documents.page_ui.title_label") })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: label() })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.actions.menu_label") }));
    expect(await screen.findByRole("menuitem", { name: t("documents.actions.versions") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
    unmount();

    const ordinary = summary({ id: "fo1", kind: "folder", title: "Dự án CCB", breadcrumbs: [] }) as unknown as Parameters<typeof DocumentActionsMenu>[0]["doc"];
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={sessionUser}>
          <DocumentActionsMenu wsId={WS} doc={ordinary} />
        </WorkspaceProvider>,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: t("documents.actions.menu_label") }));
    expect(await screen.findByRole("menuitem", { name: t("documents.actions.share") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.archive") })).toBeInTheDocument();
  });

  it("translates a my_folder_locked error to the house-voice sentence and toasts it once without the raw code", async () => {
    const err = new ApiError("server text", "my_folder_locked", 409);
    const translated = documentErrorMessage(err, t, "documents.home.create_failed");
    expect(translated).toBe(t("documents.errors.my_folder_locked"));
    expect(translated).not.toBe("documents.errors.my_folder_locked");
    expect(translated).not.toContain("my_folder_locked");

    route({
      list: () => [],
      post: () => {
        throw err;
      },
    });
    renderView();
    fireEvent.click(await pill("page"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(t("documents.errors.my_folder_locked"));
  });

  it("finds a known My Folder by its localized label in vi and en without calling ensure or duplicating server hits", async () => {
    const i18n = initI18n();
    route({
      tree: () => [treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder" })],
      list: (path) => (path.includes("q=") ? [] : []),
      detail: () => myFolderDoc(),
    });
    const nav = renderView();
    await screen.findByRole("treeitem", { name: new RegExp(label()) });

    const searchInput = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
    fireEvent.change(searchInput, { target: { value: "  thư mục của " } });
    const list = await screen.findByRole("list", { name: t("documents.home.search.label") });
    const viButtons = within(list).getAllByRole("button");
    expect(viButtons).toHaveLength(1);
    expect(viButtons[0]).toHaveTextContent("Thư mục của tôi");
    expect(posts(MY_FOLDER_URL)).toHaveLength(0);

    fireEvent.click(viButtons[0]!);
    await waitFor(() => expect(nav.searchParams.get("folder")).toBe("mf1"));

    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      route({
        tree: () => [treeNode({ id: "mf1", title: "My Folder", kind: "folder", system_kind: "my_folder" })],
        list: (path) => (path.includes("q=") ? [myFolderDoc()] : []),
      });
      const searchInputEn = screen.getByRole("searchbox", { name: t("documents.home.search.label") });
      fireEvent.change(searchInputEn, { target: { value: "my fold" } });
      const listEn = await screen.findByRole("list", { name: t("documents.home.search.label") });
      const enButtons = within(listEn).getAllByRole("button");
      expect(enButtons).toHaveLength(1);
      expect(enButtons[0]).toHaveTextContent("My Folder");
      expect(posts(MY_FOLDER_URL)).toHaveLength(0);
    } finally {
      await act(async () => {
        await i18n.changeLanguage("vi");
      });
    }
  });
});
