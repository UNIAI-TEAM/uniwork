import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// The TRASH-A3 boards (Main.dc.html / Folder.dc.html / Trash.dc.html): the
// header row, the Tạo nhanh strip, the filter bar, the folder cards with
// counts, the folder view and the Trash view in the Documents home.

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const MEMBERS_URL = `/api/v1/workspaces/${WS}/members`;
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function summary(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    updated_at: "2026-10-15T03:00:00Z",
    my_level: "edit",
    ...over,
  };
}

function file(id: string, title: string, over: Record<string, unknown> = {}) {
  return summary({ id, kind: "file", title, organization_id: "org1", current_version: 1, ...over });
}

function treeNode(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "fo0", title: "Node", kind: "folder", position: 0, children: [], ...over };
}

function folderDetail(over: Record<string, unknown> = {}) {
  return summary({ id: "fo1", kind: "folder", title: "Dự án CCB", revision: "3", my_level: "manage", breadcrumbs: [], ...over });
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  sources?: (path: string) => unknown[];
  detail?: (id: string) => unknown;
  members?: () => unknown[];
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path.includes("/documents/favorites")) return Promise.resolve({ favorites: [] });
    if (method === "POST" && path.endsWith("/favorite")) return Promise.resolve({ favorite: { document_id: "fo1", workspace_id: WS, title: "", kind: "folder" } });
    const run = (fn: () => unknown) => {
      try {
        return Promise.resolve(fn());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    if (path === MEMBERS_URL) return run(() => ({ members: routes.members?.() ?? [] }));
    if (path.startsWith(TREE_URL)) return run(() => ({ documents: routes.tree?.() ?? [] }));
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return Promise.resolve({ items: routes.sources?.(path) ?? [], next_cursor: null });
    }
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      return run(() => {
        const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
        return doc ? { document: doc } : {};
      });
    }
    if (path.startsWith(LIST_BASE)) {
      return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: null }));
    }
    return Promise.resolve({});
  });
}

const queryOf = (path: string) => new URLSearchParams(path.split("?")[1] ?? "");
const listPaths = () => requestMock.mock.calls.map(([path]) => String(path)).filter((p) => p.startsWith(LIST_BASE) && !p.startsWith(TREE_URL) && !p.startsWith(`${LIST_BASE}/sources`));

function renderView(initialUrl = "/acme/doi/documents") {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  const adapter = fakeNav(initialUrl);
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      adapter,
    ),
  );
  return adapter;
}

async function choose(comboboxName: string | RegExp, option: string | RegExp) {
  fireEvent.click(await screen.findByRole("combobox", { name: comboboxName }));
  const optionEl = within(await screen.findByRole("listbox")).getByText(option);
  // Base UI only commits a click that started on the item with a pointer.
  fireEvent.pointerDown(optionEl);
  fireEvent.click(optionEl);
}

beforeEach(() => {
  requestMock.mockReset();
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

describe("home layout (Main.dc)", () => {
  it("shows the board header row: the title, search, Upload and the New menu, and no create cards or greeting", async () => {
    route({ list: () => [summary()] });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    expect(await screen.findByRole("heading", { level: 1, name: t("documents.home.sidebar.home") })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: t("documents.home.search.label") })).toHaveAttribute(
      "placeholder",
      t("documents.home.search.placeholder"),
    );
    expect(screen.getByRole("button", { name: t("documents.home.create.upload.button") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeInTheDocument();
    // No My Folder root-create hint line under Tạo nhanh (user 2026-10-19).
    expect(screen.queryByText(/Thư mục của tôi \(chỉ bạn thấy\)/)).toBeNull();

    // The greeting, the create card grid, the scope tabs and the old chips are gone.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("group", { name: t("documents.home.chips_label") })).toBeNull();
    expect(screen.queryByRole("combobox", { name: t("documents.home.group_by.label") })).toBeNull();
    expect(screen.queryByText(/Chào buổi/)).toBeNull();
  });

  it("shows the Tạo nhanh strip with one pill per type, and creates from it", async () => {
    route({ list: () => [] });
    renderView();
    const strip = await screen.findByRole("region", { name: t("documents.home.quick_create.label") });
    const chipTypes = ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"] as const;
    for (const type of chipTypes) {
      expect(within(strip).getByRole("button", { name: new RegExp(t(`documents.home.create.${type}.chip`)) })).toBeInTheDocument();
    }

    fireEvent.click(within(strip).getByRole("button", { name: new RegExp(t("documents.home.create.docx.chip")) }));
    await waitFor(() => {
      const call = requestMock.mock.calls.find(
        ([path, opts]) =>
          String(path) === `${LIST_BASE}/files/blank` && (opts as { method?: string } | undefined)?.method === "POST",
      );
      expect(call).toBeTruthy();
      expect((call![1] as { body: unknown }).body).toMatchObject({ format: "docx" });
    });
  });

  it("filters documents by editor and by recency through the server list params", async () => {
    route({
      list: () => [summary()],
      members: () => [
        { workspace_id: WS, user_id: "u2", role: "member", email: "dung@example.com", display_name: "Dũng" },
      ],
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    const before = listPaths().length;
    await choose(new RegExp(`^${t("documents.home.filters.editor")}`), "Dũng");
    await waitFor(() => {
      const next = listPaths().slice(before);
      expect(next.some((p) => queryOf(p).get("updated_by") === "u2")).toBe(true);
    });

    const afterEditor = listPaths().length;
    await choose(new RegExp(`^${t("documents.home.filters.updated")}`), t("documents.home.filters.updated_7d"));
    await waitFor(() => {
      const next = listPaths().slice(afterEditor);
      const from = next.map((p) => queryOf(p).get("updated_from")).find(Boolean);
      expect(from).toBeTruthy();
      const fromMs = Date.parse(from!);
      // "7 ngày qua" resolves to roughly now - 7 days.
      expect(fromMs).toBeGreaterThan(Date.now() - 8 * 86400_000);
      expect(fromMs).toBeLessThan(Date.now() - 6 * 86400_000);
    });
  });

  it("lists workspace folders as cards with their contents count, never as table rows", async () => {
    route({
      tree: () => [
        treeNode({
          id: "fo1",
          title: "Sai đẹp chiêu",
          children: [
            treeNode({ id: "fob", title: "Bên trong", parent_id: "fo1" }),
            treeNode({ id: "pg1", title: "Trang", kind: "page", parent_id: "fo1" }),
          ],
        }),
      ],
      list: () => [
        summary({ id: "fo1", kind: "folder", title: "Sai đẹp chiêu" }),
        summary({ id: "d1", title: "Kế hoạch Q4" }),
      ],
    });
    const adapter = renderView();
    const section = await screen.findByRole("region", { name: new RegExp(`^${t("documents.home.sections.folders")} [0-9]+$`) });
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/1$/);
    const card = await within(section).findByRole("button", { name: /^Sai đẹp chiêu/ });
    // Subfolders come from the tree; documents are never counted on a card.
    expect(card).toHaveTextContent(t("documents.home.folder_card.folders", { count: 1 }));
    expect(card).not.toHaveTextContent(/tài liệu/i);

    // The folder is a card, not a row of the documents table, which counts its own rows.
    expect(within(screen.getByRole("table")).queryByText("Sai đẹp chiêu")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: new RegExp(`^${t("documents.home.sections.documents")}`) })).toHaveTextContent(/1$/);

    fireEvent.click(card);
    await waitFor(() => expect(adapter.push).toHaveBeenCalledWith(expect.stringContaining("fo1")));
  });

  it("stars a folder from its card menu (SV-4)", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Sai đẹp chiêu" })],
      list: () => [summary({ id: "fo1", kind: "folder", title: "Sai đẹp chiêu", my_level: "manage" })],
    });
    renderView();
    const section = await screen.findByRole("region", { name: new RegExp(`^${t("documents.home.sections.folders")} [0-9]+$`) });
    const trigger = await within(section).findByRole("button", { name: t("documents.home.row.menu", { title: "Sai đẹp chiêu" }) });
    // The ⋯ sits inside the card's right edge, not in the gap between cards:
    // pinned over the card (absolute in a relative item) with room reserved on the card.
    const card = within(section).getByRole("button", { name: /^Sai đẹp chiêu/ });
    expect(trigger.parentElement).toBe(card.parentElement);
    expect(card.parentElement).toHaveClass("relative");
    expect(trigger).toHaveClass("absolute", "right-2");
    expect(card).toHaveClass("pr-12");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.star") }));
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, opts]) => path === "/api/v1/documents/fo1/favorite" && (opts as { method?: string } | undefined)?.method === "POST",
        ),
      ).toBe(true),
    );
  });
});

describe("folder layout (Folder.dc)", () => {
  const folderRoutes = (children: unknown[] = [treeNode({ id: "fos", title: "Bên trong", parent_id: "fo1" })]) => ({
    tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", children })],
    detail: (id: string) =>
      id === "fo1" ? folderDetail({ breadcrumbs: [] }) : null,
    list: (path: string) =>
      queryOf(path).get("parent_id") === "fo1"
        ? [summary({ id: "fos", kind: "folder", title: "Bên trong", parent_id: "fo1" }), file("f1", "Báo giá.docx", { parent_id: "fo1" })]
        : [],
  });

  it("shows the breadcrumb, the folder name with its menu, in-folder search and the info line", async () => {
    route(folderRoutes());
    renderView(`/acme/doi/documents?folder=fo1`);
    await screen.findByText("Báo giá.docx");

    const crumb = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumb).getByRole("button", { name: t("documents.home.sidebar.home") })).toBeInTheDocument();
    // One row (UNI-1977): the folder name is the breadcrumb leaf, once; the
    // rename pencil and the folder menu sit right beside it, and the actions
    // share the header row container.
    const heading = await screen.findByRole("heading", { level: 1, name: "Dự án CCB" });
    expect(crumb).toContainElement(heading);
    const menuButton = screen.getByRole("button", { name: t("documents.home.folder.menu") });
    expect(crumb).toContainElement(menuButton);
    expect(crumb).toContainElement(screen.getByRole("button", { name: t("documents.home.folders.rename") }));
    expect(within(heading).queryByRole("button")).toBeNull();
    const row = crumb.parentElement?.parentElement;
    expect(within(row as HTMLElement).getAllByText("Dự án CCB")).toHaveLength(1);
    expect(row).toContainElement(screen.getByRole("searchbox", { name: t("documents.home.search.label") }));
    expect(row).toContainElement(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    expect(screen.getByRole("searchbox", { name: t("documents.home.search.label") })).toHaveAttribute(
      "placeholder",
      t("documents.home.search.placeholder_folder"),
    );
    expect(screen.queryByText(/Dự án CCB”/)).toBeNull();

    // No Tạo nhanh strip, no scope tabs, no chip group, no filters inside a folder.
    expect(screen.queryByRole("region", { name: t("documents.home.quick_create.label") })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("group", { name: t("documents.home.chips_label") })).toBeNull();
    expect(screen.queryByRole("combobox", { name: new RegExp(t("documents.home.filters.editor")) })).toBeNull();
    expect(screen.getByRole("combobox", { name: t("documents.home.sort.label") })).toBeInTheDocument();
  });

  it("lists subfolders as cards under their own section, and documents under Tài liệu", async () => {
    route(folderRoutes());
    renderView(`/acme/doi/documents?folder=fo1`);
    await screen.findByText("Báo giá.docx");

    expect(await screen.findByRole("heading", { name: new RegExp(t("documents.home.sections.subfolders")) })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: new RegExp(t("documents.home.sections.documents")) })).toBeInTheDocument();
    const sub = screen.getByRole("region", { name: new RegExp(`^${t("documents.home.sections.subfolders")} [0-9]+$`) });
    expect(within(sub).getByRole("button", { name: /^Bên trong/ })).toBeInTheDocument();
    // The subfolder is a card, not also a table row.
    expect(within(screen.getByRole("table")).queryByText("Bên trong")).toBeNull();
  });

  it("hides create and upload and the info line for a read-only folder", async () => {
    route({
      ...folderRoutes([]),
      detail: (id) => (id === "fo1" ? folderDetail({ my_level: "view" }) : null),
    });
    renderView(`/acme/doi/documents?folder=fo1`);
    await screen.findByRole("heading", { level: 1, name: /Dự án CCB/ });
    expect(screen.queryByRole("button", { name: t("documents.home.create.upload.button") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeNull();
    expect(screen.queryByText(/sẽ vào thư mục/)).toBeNull();
  });
});

describe("trash view (Trash.dc)", () => {
  it("shows the dedicated trash table with restore, not the library table", async () => {
    route({
      list: (path) =>
        queryOf(path).get("archived") === "1"
          ? [summary({ id: "a1", title: "Cũ", archived_at: "2026-10-01T00:00:00Z", my_level: "manage" })]
          : [],
    });
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.trash")) })[0]!);

    expect(await screen.findByRole("heading", { level: 1, name: t("documents.trash.title") })).toBeInTheDocument();
    await screen.findByText("Cũ");
    expect(screen.getByRole("columnheader", { name: t("documents.trash.columns.deleted_by") })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: t("documents.trash.columns.purge_in") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.trash.restore_item", { title: "Cũ" }) })).toBeInTheDocument();
    // The old scope tabs / chips / group-by never appear here.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("combobox", { name: t("documents.home.group_by.label") })).toBeNull();
    expect(screen.queryByRole("heading", { level: 2, name: t("documents.home.views.archived") })).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: t("documents.home.sidebar.home") })).toBeNull();
  });
});
