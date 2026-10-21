import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";
import { LibraryRowAccessCell } from "./library-row-access-cell";
import { specLadder } from "./library-columns";
import { canShareRow } from "./row-level";
import type { DocumentSummaryRow } from "./library-rows";

// UNI-2055 A1: workspace folders (kind folder, visibility workspace, no
// system_kind) take new content from every human member, keep rename / move /
// trash for people who manage them, and show no access pill.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function folderRow(over: Record<string, unknown> = {}) {
  return {
    id: "fo1",
    organization_id: "org1",
    workspace_id: WS,
    kind: "folder",
    system_kind: null,
    title: "Báo cáo",
    visibility: "workspace",
    revision: "3",
    my_level: "view",
    breadcrumbs: [],
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function treeFolder(over: Record<string, unknown> = {}) {
  return { id: "fo1", title: "Báo cáo", kind: "folder", visibility: "workspace", position: 0, children: [], ...over };
}

interface Routes {
  role?: string;
  tree?: () => unknown[];
  list?: () => unknown[];
  detail?: (id: string) => unknown;
  post?: () => unknown;
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path === `/api/v1/workspaces/${WS}/me`) {
      return Promise.resolve({ membership: { user_id: "u1", role: routes.role ?? "member", source: "membership" } });
    }
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: routes.tree?.() ?? [] });
    if (method === "POST") return Promise.resolve(routes.post?.() ?? {});
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
      return Promise.resolve(doc ? { document: doc } : {});
    }
    if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: routes.list?.() ?? [], next_cursor: null });
    return Promise.resolve({});
  });
}

function renderView(nav = fakeNav()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={sessionUser}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      nav,
    ),
  );
}

async function openFolder(name: RegExp | string = /Báo cáo/) {
  fireEvent.click(await screen.findByRole("treeitem", { name }));
}

/** The folder card's ⋯ button: the sidebar tree row carries a menu with the same name. */
async function cardTrigger(title = "Báo cáo") {
  const name = t("documents.home.row.menu", { title });
  await waitFor(() => expect(screen.getAllByRole("button", { name }).some((b) => !b.closest('[role="tree"]'))).toBe(true));
  return screen.getAllByRole("button", { name }).find((b) => !b.closest('[role="tree"]'))!;
}

const createMenu = () => screen.queryByRole("button", { name: new RegExp(t("documents.home.create.menu")) });
const crumbs = () => screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });

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

describe("workspace folder: create inside without widening rename (UNI-2055 W3/W4)", () => {
  it("shows a member New, upload and the sidebar create at my_level view, but no rename in the header", async () => {
    route({ tree: () => [treeFolder()], detail: () => folderRow({ my_level: "view" }) });
    renderView();
    await openFolder();

    expect(await screen.findByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.home.create.upload.button") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.home.folders.new") })).toBeInTheDocument();
    expect(screen.queryByText(t("documents.home.empty.view_only"))).toBeNull();
    expect(within(crumbs()).queryByRole("button", { name: t("documents.home.folders.rename") })).toBeNull();
  });

  it("keeps the rename in the header for the creator or an admin (my_level manage)", async () => {
    route({ tree: () => [treeFolder()], detail: () => folderRow({ my_level: "manage" }) });
    renderView();
    await openFolder();

    expect(await screen.findByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeInTheDocument();
    expect(within(crumbs()).getByRole("button", { name: t("documents.home.folders.rename") })).toBeInTheDocument();
  });

  it("lets a workspace admin without an explicit level create too (the role is read from the workspace)", async () => {
    route({ role: "admin", tree: () => [treeFolder()], detail: () => folderRow({ my_level: "view" }) });
    renderView();
    await openFolder();
    expect(await screen.findByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeInTheDocument();
  });

  it("keeps a read-only workspace role (viewer / unknown) on the view-only screen", async () => {
    route({ role: "viewer", tree: () => [treeFolder()], detail: () => folderRow({ my_level: "view" }) });
    renderView();
    await openFolder();

    expect(await screen.findByText(t("documents.home.empty.view_only"))).toBeInTheDocument();
    expect(createMenu()).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.home.folders.new") })).toBeNull();
  });

  it("does not open a restricted folder (My Folder subtree or legacy) to a member at view level", async () => {
    route({
      tree: () => [treeFolder({ visibility: "restricted" })],
      detail: () => folderRow({ visibility: "restricted", my_level: "view" }),
    });
    renderView();
    await openFolder();

    expect(await screen.findByText(t("documents.home.empty.view_only"))).toBeInTheDocument();
    expect(createMenu()).toBeNull();
  });
});

describe("workspace folder cards (UNI-2055 W2/W4)", () => {
  const cardMenu = async () => {
    fireEvent.click(await cardTrigger());
    return screen.findByRole("menu");
  };

  it("offers a member New sub-folder on a view-level card, and no rename, move or delete", async () => {
    route({ tree: () => [treeFolder()], list: () => [folderRow({ my_level: "view" })] });
    renderView();
    const menu = await cardMenu();

    expect(within(menu).getByRole("menuitem", { name: t("documents.home.row.new_subfolder") })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: t("documents.home.row.rename") })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeNull();
  });

  it("offers the creator the whole menu", async () => {
    route({ tree: () => [treeFolder()], list: () => [folderRow({ my_level: "manage" })] });
    renderView();
    const menu = await cardMenu();

    for (const name of [
      t("documents.home.row.new_subfolder"),
      t("documents.home.row.rename"),
      t("documents.tree.menu.move_to"),
      t("documents.tree.menu.delete"),
    ]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("offers a viewer-role member no New sub-folder", async () => {
    route({ role: "viewer", tree: () => [treeFolder()], list: () => [folderRow({ my_level: "view" })] });
    renderView();
    await screen.findByRole("treeitem", { name: /Báo cáo/ });
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(`/api/v1/workspaces/${WS}/me`));
    // The card has no menu at all for a read-only role without Star; if it does, it lists no create entry.
    const trigger = screen.queryAllByRole("button", { name: t("documents.home.row.menu", { title: "Báo cáo" }) }).find((b) => !b.closest('[role="tree"]'));
    if (trigger) {
      fireEvent.click(trigger);
      expect(screen.queryByRole("menuitem", { name: t("documents.home.row.new_subfolder") })).toBeNull();
    }
  });
});

describe("create note from a card's New sub-folder (UNI-2055 W1)", () => {
  const note = () => t("documents.home.folders.create_workspace_note");

  it("notes a workspace folder card and nothing on My Folder's", async () => {
    route({
      tree: () => [
        treeFolder(),
        treeFolder({ id: "mf", title: "Thư mục của tôi", system_kind: "my_folder", visibility: "restricted" }),
      ],
      list: () => [
        folderRow({ my_level: "view" }),
        folderRow({ id: "mf", title: "Thư mục của tôi", system_kind: "my_folder", visibility: "restricted", my_level: "manage" }),
      ],
    });
    renderView();

    fireEvent.click(await cardTrigger("Báo cáo"));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.new_subfolder") }));
    const first = await screen.findByRole("dialog");
    expect(within(first).getByText(note())).toBeInTheDocument();
    fireEvent.click(within(first).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(await cardTrigger(t("documents.home.my_folder.label")));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.new_subfolder") }));
    const second = await screen.findByRole("dialog");
    expect(within(second).queryByText(note())).toBeNull();
  });
});

describe("folder card empty hint (UNI-2055 W6)", () => {
  // The hint leads the card's meta line ("Trống · 28/09"), so it is matched as the start of that line.
  const hint = () => new RegExp(`^${t("documents.home.folder_card.empty")}`);

  it("says the folder is empty when is_empty is true on the tree node or the list row", async () => {
    route({ tree: () => [treeFolder({ is_empty: true })], list: () => [folderRow()] });
    renderView();
    const card = (await cardTrigger()).closest("li")!;
    expect(within(card).getByText(hint())).toBeInTheDocument();
  });

  it("shows no hint and no count when it is false or unknown", async () => {
    route({
      tree: () => [treeFolder({ is_empty: false }), treeFolder({ id: "fo2", title: "Kế toán" })],
      list: () => [folderRow(), folderRow({ id: "fo2", title: "Kế toán" })],
    });
    renderView();
    await cardTrigger("Kế toán");
    expect(screen.queryByText(hint())).toBeNull();
  });
});

describe("folder rows show no access pill (UNI-2055 W1)", () => {
  const row = (over: Partial<DocumentSummaryRow>): DocumentSummaryRow =>
    ({
      id: "fo1",
      organization_id: "org1",
      workspace_id: WS,
      kind: "folder",
      system_kind: null,
      title: "Báo cáo",
      visibility: "workspace",
      revision: "3",
      current_version: 0,
      position: 0,
      my_level: "manage",
      created_by: "",
      created_by_kind: "human",
      updated_by: "",
      updated_by_kind: "human",
      created_at: "",
      updated_at: "2026-09-28T03:00:00Z",
      ...over,
    }) as DocumentSummaryRow;

  const cell = (doc: DocumentSummaryRow) =>
    render(
      <table>
        <tbody>
          <tr>
            <LibraryRowAccessCell doc={doc} scope={null} isOwner={false} title={doc.title} workspaceName="Đội" ladder={specLadder("workspace", { selectable: false })} />
          </tr>
        </tbody>
      </table>,
    );

  it("renders an empty access cell for a workspace folder, whatever the level", () => {
    for (const my_level of ["view", "manage"]) {
      const { container, unmount } = cell(row({ my_level }));
      expect(container.querySelector("[data-access-kind]")).toBeNull();
      expect(screen.queryByText(t("documents.list.access.workspace"))).toBeNull();
      expect(screen.queryByText(t("documents.list.access.restricted"))).toBeNull();
      expect(container.querySelector("td")?.textContent).toBe("");
      unmount();
    }
  });

  it("renders no pill for a restricted folder either, and keeps the pill on a page", () => {
    const folder = cell(row({ visibility: "restricted" }));
    expect(folder.container.querySelector("[data-access-kind]")).toBeNull();
    folder.unmount();

    const page = cell(row({ kind: "page", visibility: "workspace" }));
    expect(page.container.querySelector("[data-access-kind='workspace']")).not.toBeNull();
  });

  it("offers no Share on a workspace folder", () => {
    expect(canShareRow({ kind: "folder", organization_id: "org1", system_kind: null, owner_kind: null, archived_at: null })).toBe(false);
  });
});

describe("create folder with a taken name (UNI-2055 W5)", () => {
  it("toasts and opens the title and id the server returned, not the typed name", async () => {
    const created = folderRow({ id: "fo9", title: "Báo cáo (1)", my_level: "manage" });
    route({ list: () => [], post: () => ({ document: created }), detail: () => created });
    const nav = fakeNav();
    renderView(nav);

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.folders.new") }));
    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title_root") });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Báo cáo" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.home.folders.toast.created", { title: "Báo cáo (1)" })),
    );
    expect(toast.success).not.toHaveBeenCalledWith(t("documents.home.folders.toast.created", { title: "Báo cáo" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringContaining("fo9")));
    expect(within(await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") }, { timeout: 5000 })).getByText("Báo cáo (1)")).toBeInTheDocument();
    const post = requestMock.mock.calls.find(([, opts]) => (opts as { method?: string } | undefined)?.method === "POST");
    expect((post?.[1] as { body?: { title?: string } }).body?.title).toBe("Báo cáo");
  });
});
