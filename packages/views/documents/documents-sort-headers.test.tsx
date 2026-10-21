import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { defaultStorage } from "@uniwork/core/platform";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// UNI-2038 S2: the table headers are the one sort control. The lists that page
// on the server send `sort`/`order` and show the pages as the server ordered
// them; the lists loaded in full (Starred, an open folder) are ordered here.
// The fake server answers the pages already in the order it was asked for.

const { t } = initI18n();

const WS = "ws1";
const ORG = "o1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const FAVORITES_URL = `/api/v1/orgs/${ORG}/documents/favorites`;

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: WS,
  slug: "team",
  name: "Team",
  organization_id: ORG,
  organization_slug: "acme",
  organization_name: "Acme",
};

function renderView(initialUrl?: string) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      fakeNav(initialUrl),
    ),
  );
}

function summary(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    my_level: "manage",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function file(id: string, title: string, over: Record<string, unknown> = {}) {
  return summary({ id, kind: "file", title, organization_id: ORG, current_version: 1, my_level: "edit", ...over });
}

function folderDetail(over: Record<string, unknown> = {}) {
  return summary({ id: "fo1", kind: "folder", title: "Dự án CCB", revision: "3", my_level: "manage", ...over });
}

function source(over: Record<string, unknown> = {}) {
  return {
    id: "chat:m1",
    source: "chat",
    parent: { kind: "chat_channel", id: "c1", title: "Kênh chung" },
    name: "Đề xuất ngân sách.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 2_400_000,
    updated_at: "2026-10-09T03:00:00Z",
    owner: { id: "u2", kind: "human", name: "Dũng" },
    can_open_in_app: true,
    can_save: true,
    ...over,
  };
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  cursor?: (path: string) => string | null;
  sources?: (path: string) => unknown[];
  sourcesCursor?: (path: string) => string | null;
  favorites?: () => unknown[];
  /** The Starred screen's rows, GET {LIST_BASE}/favorites (UNI-2045 SV-2). */
  starred?: () => unknown[];
  detail?: (id: string) => unknown;
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
    if (path === FAVORITES_URL) return run(() => ({ favorites: routes.favorites?.() ?? [] }));
    if (path.startsWith(`${LIST_BASE}/favorites`)) return run(() => ({ documents: routes.starred?.() ?? [], next_cursor: null }));
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return run(() => ({ items: routes.sources?.(path) ?? [], next_cursor: routes.sourcesCursor?.(path) ?? null }));
    }
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      return run(() => {
        const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
        return doc ? { document: doc } : {};
      });
    }
    if (path.startsWith(LIST_BASE)) {
      return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: routes.cursor?.(path) ?? null }));
    }
    return Promise.resolve({});
  });
}


const queryOf = (path: string) => new URLSearchParams(String(path).split("?")[1] ?? "");
const calls = (prefix: string, exact = false) =>
  requestMock.mock.calls
    .map(([path]) => String(path))
    .filter((path) => (exact ? path.split("?")[0] === prefix : path.startsWith(prefix)));
const listCalls = () => calls(LIST_BASE, true);
const sourceCalls = () => calls(`${LIST_BASE}/sources`);
const lastQuery = (paths: string[]) => queryOf(paths.at(-1) ?? "");

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sortButton = (column: "name" | "editor" | "updated" | "size") =>
  screen.findByRole("button", {
    name: new RegExp(`^${escape(t("documents.home.sort.column", { column: t(`documents.home.columns.${column}`) }))}`),
  });
const headerOf = (column: "name" | "editor" | "updated" | "size") =>
  screen.getByRole("columnheader", { name: new RegExp(`^${escape(t(`documents.home.columns.${column}`))}`) });
const rowOrder = () => Array.from(document.querySelectorAll("[data-library-row]")).map((tr) => tr.getAttribute("data-library-row"));

/** Serves each list in the order its own `sort`/`order` ask for, from titles by id. */
function sortedBy(rows: { id: string; title: string; updated_at: string }[]) {
  return (path: string) => {
    const q = queryOf(path);
    const column = q.get("sort");
    const sign = q.get("order") === "asc" ? 1 : -1;
    if (!column) return rows.map((r) => summary(r));
    const key = (r: { title: string; updated_at: string }) => (column === "name" ? r.title : r.updated_at);
    return [...rows].sort((a, b) => sign * key(a).localeCompare(key(b))).map((r) => summary(r));
  };
}

const ROWS = [
  { id: "d-b", title: "Bình", updated_at: "2026-10-01T00:00:00Z" },
  { id: "d-a", title: "An", updated_at: "2026-10-03T00:00:00Z" },
  { id: "d-c", title: "Chi", updated_at: "2026-10-02T00:00:00Z" },
];

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  for (const key of ["uniwork_documents_sort:u1", "uniwork_documents_folder_sort:u1"]) defaultStorage.removeItem(key);
  setSessionUser(user);
});

describe("the table headers sort (UNI-2038 S2)", () => {
  it("home root: asks for sort=updated&order=desc, marks Cập nhật, then re-asks the server for Tên ascending and descending", async () => {
    route({ list: sortedBy(ROWS) });
    renderView();
    await screen.findByText("An");
    expect(lastQuery(listCalls())).toMatchObject({});
    const first = lastQuery(listCalls());
    expect(first.get("sort")).toBe("updated");
    expect(first.get("order")).toBe("desc");
    expect(first.get("parent_id")).toBe("");
    expect(rowOrder()).toEqual(["d-a", "d-c", "d-b"]);
    expect(headerOf("updated")).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "d-c"]));
    expect(lastQuery(listCalls()).get("sort")).toBe("name");
    expect(lastQuery(listCalls()).get("order")).toBe("asc");
    expect(headerOf("name")).toHaveAttribute("aria-sort", "ascending");
    expect(headerOf("updated")).toHaveAttribute("aria-sort", "none");

    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["d-c", "d-b", "d-a"]));
    expect(lastQuery(listCalls()).get("order")).toBe("desc");
    expect(headerOf("name")).toHaveAttribute("aria-sort", "descending");
  });

  it("keeps keyboard focus on the header button and the table on screen while the re-ordered page loads", async () => {
    const user = userEvent.setup();
    route({ list: sortedBy(ROWS) });
    renderView();
    await screen.findByText("An");
    const button = await sortButton("name");
    button.focus();
    await user.keyboard("{Enter}");
    // No skeleton swap: the same button is still in the document and still focused.
    expect(screen.queryByLabelText(t("documents.library.loading"))).toBeNull();
    expect(button).toBeInTheDocument();
    expect(button).toHaveFocus();
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "d-c"]));
    expect(button).toHaveFocus();
  });

  it("keeps the server's pages as they come: a second page is appended below, never re-sorted in", async () => {
    route({
      // Page 1 ends at "Chi", page 2 holds "An"; a client sort would hoist "An" to the top.
      list: (path) =>
        queryOf(path).get("cursor") === "p2"
          ? [summary({ id: "d-a", title: "An", updated_at: "2026-10-03T00:00:00Z" })]
          : [summary({ id: "d-b", title: "Bình" }), summary({ id: "d-c", title: "Chi" })],
      cursor: (path) => (queryOf(path).get("cursor") === "p2" ? null : "p2"),
    });
    renderView();
    await screen.findByText("Bình");
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    await screen.findByText("An");
    expect(rowOrder()).toEqual(["d-b", "d-c", "d-a"]);
  });

  it("merges the sources into the home table in the chosen order, and sends the same sort to the sources list", async () => {
    route({
      list: sortedBy(ROWS),
      sources: (path) => [source({ id: "chat:m1", name: queryOf(path).get("order") === "asc" ? "Bz.pdf" : "Xây.pdf" })],
    });
    renderView();
    await screen.findByText("An");
    await waitFor(() => expect(lastQuery(sourceCalls()).get("sort")).toBe("updated"));
    expect(lastQuery(sourceCalls()).get("order")).toBe("desc");
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(lastQuery(sourceCalls()).get("sort")).toBe("name"));
    expect(lastQuery(sourceCalls()).get("order")).toBe("asc");
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "source:chat:m1", "d-c"]));
  });

  it("keeps the merged order of the old sort while the re-sorted pages are still loading (placeholder window)", async () => {
    route({
      list: sortedBy(ROWS),
      sources: () => [source({ id: "chat:m1", name: "Đề xuất.pdf", updated_at: "2026-10-02T12:00:00Z" })],
    });
    renderView();
    await screen.findByText("An");
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "source:chat:m1", "d-c", "d-b"]));

    // Hold every answer to the Tên request: both lists keep their previous pages as placeholder data.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const answer = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      queryOf(path).get("sort") === "name" ? gate.then(() => answer(path, opts)) : answer(path, opts),
    );
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(lastQuery(listCalls()).get("sort")).toBe("name"));
    await waitFor(() => expect(lastQuery(sourceCalls()).get("sort")).toBe("name"));
    // The arrow moved at once; the rows are still the old pages, merged the way they were fetched.
    expect(headerOf("name")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["d-a", "source:chat:m1", "d-c", "d-b"]);

    release();
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "d-c", "source:chat:m1"]));
  });

  it.each([
    ["recent", "recent", `${LIST_BASE}/recent`],
    ["shared", "shared", `${LIST_BASE}/shared-with-me`],
  ])("%s view: the request carries sort/order and a header click changes it", async (_name, view, base) => {
    requestMock.mockImplementation((path: string) => {
      const p = String(path);
      if (p.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (p === FAVORITES_URL) return Promise.resolve({ favorites: [] });
      if (p.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
      if (p.split("?")[0] === base) return Promise.resolve({ documents: sortedBy(ROWS)(p), next_cursor: null });
      return Promise.resolve({ documents: [], next_cursor: null });
    });
    renderView(`/org/${WS}/documents?view=${view}`);
    await screen.findByText("An");
    expect(lastQuery(calls(base, true)).get("sort")).toBe("updated");
    expect(lastQuery(calls(base, true)).get("order")).toBe("desc");
    expect(headerOf("updated")).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "d-c"]));
    expect(lastQuery(calls(base, true)).get("sort")).toBe("name");
    expect(lastQuery(calls(base, true)).get("order")).toBe("asc");
  });

  it("shared-by-me view: the request keeps shared_by_me=true and carries sort/order", async () => {
    route({ list: sortedBy(ROWS) });
    renderView(`/org/${WS}/documents?view=shared-by-me`);
    await screen.findByText("An");
    const q = lastQuery(listCalls());
    expect(q.get("shared_by_me")).toBe("true");
    expect(q.get("sort")).toBe("updated");
    expect(q.get("order")).toBe("desc");
    expect(q.has("parent_id")).toBe(false);
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(lastQuery(listCalls()).get("sort")).toBe("name"));
    expect(lastQuery(listCalls()).get("shared_by_me")).toBe("true");
    expect(headerOf("name")).toHaveAttribute("aria-sort", "ascending");
  });

  it("starred view: sorts the loaded favorites on the client without a list refetch", async () => {
    route({
      list: () => [],
      starred: () => [
        summary({ id: "s-b", kind: "file", title: "Bình.docx" }),
        summary({ id: "s-a", kind: "file", title: "An.docx" }),
        summary({ id: "s-c", kind: "file", title: "Chi.docx" }),
      ],
    });
    renderView(`/org/${WS}/documents?view=starred`);
    await screen.findByText("An.docx");
    const before = requestMock.mock.calls.length;
    expect(listCalls().every((path) => !queryOf(path).get("sort"))).toBe(true);
    expect(requestMock.mock.calls.some(([path]) => String(path) === `${LIST_BASE}/favorites?limit=50`)).toBe(true);

    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["s-a", "s-b", "s-c"]));
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["s-c", "s-b", "s-a"]));
    expect(requestMock.mock.calls.length).toBe(before);
  });

  it("an open folder sorts on the client after loading and sends no sort", async () => {
    route({
      tree: () => [{ id: "fo1", title: "Dự án CCB", kind: "folder", position: 0, children: [] }],
      detail: (id) => (id === "fo1" ? folderDetail() : null),
      list: (path) =>
        queryOf(path).get("parent_id") === "fo1"
          ? ROWS.map((r) => summary({ ...r, parent_id: "fo1" }))
          : [],
    });
    renderView(`/org/${WS}/documents?folder=fo1`);
    await screen.findByText("An");
    expect(rowOrder()).toEqual(["d-a", "d-c", "d-b"]);
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "d-c"]));
    expect(listCalls().every((path) => !queryOf(path).get("sort"))).toBe(true);
    expect(screen.queryByRole("combobox", { name: /^Sắp xếp|^Sort/ })).toBeNull();
  });

  it("Truy cập and Thao tác headers have no button on any of these views", async () => {
    route({ list: sortedBy(ROWS) });
    renderView(`/org/${WS}/documents?view=recent`);
    await screen.findByText("An");
    expect(screen.getAllByRole("button", { name: new RegExp(`^${escape(t("documents.home.sort.column", { column: "" }).trim())}`) }).length).toBeGreaterThan(0);
    const access = screen.getByRole("columnheader", { name: new RegExp(`^${escape(t("documents.home.columns.access"))}`) });
    expect(access.querySelector("button")).toBeNull();
  });

  it("remembers the choice per viewer in uniwork_documents_sort and reads it back on the next visit", async () => {
    route({ list: sortedBy(ROWS) });
    const first = renderView();
    await screen.findByText("An");
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["d-a", "d-b", "d-c"]));
    expect(JSON.parse(defaultStorage.getItem("uniwork_documents_sort:u1")!)).toEqual({ column: "name", order: "asc" });
    first.unmount();

    requestMock.mockClear();
    renderView();
    await screen.findByText("An");
    expect(headerOf("name")).toHaveAttribute("aria-sort", "ascending");
    expect(queryOf(listCalls()[0]!).get("sort")).toBe("name");
  });

  it("reads the old folder sort once, then drops its key", async () => {
    defaultStorage.setItem("uniwork_documents_folder_sort:u1", "name");
    route({ list: sortedBy(ROWS) });
    renderView();
    await screen.findByText("An");
    expect(headerOf("name")).toHaveAttribute("aria-sort", "ascending");
    expect(queryOf(listCalls()[0]!).get("sort")).toBe("name");
    expect(defaultStorage.getItem("uniwork_documents_folder_sort:u1")).toBeNull();
    expect(JSON.parse(defaultStorage.getItem("uniwork_documents_sort:u1")!)).toEqual({ column: "name", order: "asc" });
  });

  it("Lưu trữ and Thùng rác keep plain headers and send no sort", async () => {
    route({ list: sortedBy(ROWS) });
    renderView(`/org/${WS}/documents?view=shelved`);
    await screen.findByRole("table");
    expect(listCalls().every((path) => !queryOf(path).get("sort"))).toBe(true);
    expect(screen.queryAllByRole("button", { name: /^Sắp xếp theo|^Sort by/ })).toHaveLength(0);
  });
});
