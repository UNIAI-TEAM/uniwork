import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// TV-3 (approved Main.dc board): the home "Tài liệu" section lists ROOT
// documents only — the request carries parent_id="" (the server's "roots"
// marker), so a nested document never shows at home but still shows inside
// its folder and in Recent. TV-4: a folder whose children are only
// subfolders shows no "Tài liệu 0" / "folder is empty" copy.

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
const listPaths = () =>
  requestMock.mock.calls
    .map(([path]) => String(path))
    .filter((p) => p.startsWith(LIST_BASE) && !p.startsWith(TREE_URL) && !p.startsWith(`${LIST_BASE}/sources`) && !p.includes("/recent"));

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

describe("home root lists root documents only (TV-3)", () => {
  it("sends parent_id= (empty string) on the home documents request", async () => {
    route({ list: () => [file("d1", "Kế hoạch Q4")] });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    const paths = listPaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(queryOf(path).has("parent_id"), path).toBe(true);
      expect(queryOf(path).get("parent_id"), path).toBe("");
    }
  });

  it("shows a nested document inside its folder and in Recent, never at home", async () => {
    const nested = file("dn", "Quy chế làm việc.docx", { parent_id: "fo1" });
    const root = file("d1", "Kế hoạch Q4");
    route({
      tree: () => [treeNode({ id: "fo1", title: "Hợp đồng", children: [treeNode({ id: "dn", kind: "file", title: "Quy chế làm việc.docx" })] })],
      detail: (id) => (id === "fo1" ? folderDetail({ title: "Hợp đồng" }) : null),
      // What the server answers for the list the caller asked: root level for
      // parent_id="", the folder's children for parent_id=fo1, the flat list
      // without it (Recent reads its own route).
      list: (path) => {
        const parent = queryOf(path).get("parent_id");
        if (parent === "") return [root];
        if (parent === "fo1") return [nested];
        return [root, nested];
      },
    });
    renderView();
    const documents = await screen.findByRole("region", { name: /^Tài liệu [0-9]+$/ });
    expect(await within(documents).findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(within(documents).queryByText("Quy chế làm việc.docx")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /^Tài liệu 1$/ })).toBeInTheDocument();

    // Inside the folder the nested document is a row.
    fireEvent.click(await screen.findByRole("button", { name: /^Hợp đồng/ }));
    await screen.findByRole("heading", { level: 1, name: /Hợp đồng/ });
    expect(await screen.findByText("Quy chế làm việc.docx")).toBeInTheDocument();

    // And it is still in Recent.
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) })[0]!);
    expect(await screen.findByText("Quy chế làm việc.docx")).toBeInTheDocument();
  });
});

describe("folder with only subfolders (TV-4)", () => {
  const onlySubfolders = {
    tree: () => [
      treeNode({
        id: "fo1",
        title: "Dự án CCB",
        children: [treeNode({ id: "fo2", title: "Năm 2025", parent_id: "fo1" }), treeNode({ id: "fo3", title: "Năm 2026", parent_id: "fo1" })],
      }),
    ],
    detail: (id: string) => (id === "fo1" ? folderDetail() : null),
    list: (path: string) =>
      queryOf(path).get("parent_id") === "fo1"
        ? [
            summary({ id: "fo2", kind: "folder", title: "Năm 2025", parent_id: "fo1" }),
            summary({ id: "fo3", kind: "folder", title: "Năm 2026", parent_id: "fo1" }),
          ]
        : [],
  };

  it("shows the subfolder cards and hides the empty Tài liệu section entirely", async () => {
    route(onlySubfolders);
    renderView(`/acme/doi/documents?folder=fo1`);
    await screen.findByRole("button", { name: /^Năm 2025/ });
    expect(screen.getByRole("button", { name: /^Năm 2026/ })).toBeInTheDocument();

    // No "Tài liệu 0" heading and no "this folder is empty" copy: the folder is not empty.
    await waitFor(() => expect(screen.queryByRole("heading", { name: /Tài liệu/ })).toBeNull());
    expect(screen.queryByText(t("documents.home.empty.folder_title"))).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the true empty state when the folder has neither subfolders nor documents", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB" })],
      detail: (id) => (id === "fo1" ? folderDetail() : null),
      list: () => [],
    });
    renderView(`/acme/doi/documents?folder=fo1`);
    await screen.findByRole("heading", { level: 1, name: /Dự án CCB/ });

    expect(await screen.findByRole("heading", { name: /^Tài liệu 0$/ })).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.empty.folder_title"))).toBeInTheDocument();
  });
});
