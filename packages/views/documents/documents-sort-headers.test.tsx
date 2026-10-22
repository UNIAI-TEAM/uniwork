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
const headers = () => screen.getAllByRole("columnheader");
const headerByLabel = (label: string) => headers().find((th) => th.textContent?.startsWith(label))!;
const labelOf = (id: string) => t(`documents.list.screen_column.${id}`);
const buttonByLabel = (label: string) =>
  screen.findByRole("button", { name: new RegExp(`^${escape(t("documents.home.sort.column", { column: label }))}`) });
/** The headers that claim a direction: one, the sorted column. */
const sortedHeaders = () => headers().filter((th) => ["ascending", "descending"].includes(th.getAttribute("aria-sort") ?? ""));
const sortedLabels = () => sortedHeaders().map((th) => th.textContent);
const groupHeaders = () => Array.from(document.querySelectorAll("[data-library-group]")).map((cell) => cell.textContent);
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
    ["recent", "recent", `${LIST_BASE}/recent`, "activity"],
    ["shared", "shared", `${LIST_BASE}/shared-with-me`, "shared"],
  ])("%s view: the request and the arrow carry its own order until a header click picks a column (UNI-2045 W11, W12)", async (_name, view, base, own) => {
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
    // Untouched, the list asks for the screen's own order so its date groups hold under paging.
    expect(lastQuery(calls(base, true)).get("sort")).toBe(own);
    expect(lastQuery(calls(base, true)).get("order")).toBe("desc");
    // The arrow is on the screen's own column, never on Cập nhật while the list is in its own order (W12).
    expect(headerByLabel(labelOf(own))).toHaveAttribute("aria-sort", "descending");
    expect(headerOf("updated")).toHaveAttribute("aria-sort", "none");
    expect(sortedLabels()).toEqual([labelOf(own)]);
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
    // SV-4: its own order, the latest share, until a column is picked (W12).
    expect(q.get("sort")).toBe("shared");
    expect(q.get("order")).toBe("desc");
    expect(q.has("parent_id")).toBe(false);
    expect(sortedLabels()).toEqual([labelOf("shared_with")]);
    expect(headerOf("updated")).toHaveAttribute("aria-sort", "none");
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
    expect(JSON.parse(defaultStorage.getItem("uniwork_documents_sort:u1")!)).toEqual({ workspace: { column: "name", order: "asc" } });
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
    expect(JSON.parse(defaultStorage.getItem("uniwork_documents_sort:u1")!)).toEqual({ workspace: { column: "name", order: "asc" } });
  });

  it("Lưu trữ asks for sort=shelved&order=desc, marks its own column, and re-asks for the S3 column on a click (W12, SV-0)", async () => {
    route({ list: sortedBy(ROWS) });
    renderView(`/org/${WS}/documents?view=shelved`);
    await screen.findByText("An");
    const first = lastQuery(listCalls());
    expect(first.get("shelved")).toBe("true");
    expect(first.get("sort")).toBe("shelved");
    expect(first.get("order")).toBe("desc");
    expect(sortedLabels()).toEqual([labelOf("shelved")]);
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(lastQuery(listCalls()).get("sort")).toBe("name"));
    expect(lastQuery(listCalls()).get("order")).toBe("asc");
    expect(lastQuery(listCalls()).get("shelved")).toBe("true");
    expect(sortedLabels()).toEqual([t("documents.home.columns.name")]);
  });
});

// UNI-2045 W12: the sort is one entry per screen. A screen with a screen
// column shows it sorted descending until a column is picked; the screen
// column toggles, any other column sends the S3 key; a pick on one screen
// never reaches another.
describe("the default sort of each screen (UNI-2045 W12)", () => {
  const recentUrl = `${LIST_BASE}/recent`;
  const sharedUrl = `${LIST_BASE}/shared-with-me`;
  const SCREENS = [
    { view: "recent", own: "activity", base: recentUrl },
    { view: "shared", own: "shared", base: sharedUrl },
    { view: "shared-by-me", own: "shared_with", base: LIST_BASE },
    { view: "shelved", own: "shelved", base: LIST_BASE },
  ] as const;
  const KEY: Record<string, string> = { activity: "activity", shared: "shared", shared_with: "shared", shelved: "shelved" };

  function serve(rows = ROWS) {
    requestMock.mockImplementation((path: string) => {
      const p = String(path);
      if (p.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (p === FAVORITES_URL) return Promise.resolve({ favorites: [] });
      if (p.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
      if (p.startsWith(`${LIST_BASE}/favorites`)) return Promise.resolve({ documents: [], next_cursor: null });
      if (p.startsWith(LIST_BASE)) return Promise.resolve({ documents: sortedBy(rows)(p), next_cursor: null });
      return Promise.resolve({});
    });
  }

  it.each(SCREENS)("$view: default request, one arrow on the screen column, a click toggles it and another column sends its S3 key", async ({ view, own, base }) => {
    serve();
    renderView(`/org/${WS}/documents?view=${view}`);
    await screen.findByText("An");
    const asked = () => lastQuery(calls(base, true));
    expect(asked().get("sort")).toBe(KEY[own]);
    expect(asked().get("order")).toBe("desc");
    expect(sortedLabels()).toEqual([labelOf(own)]);
    expect(headerByLabel(labelOf(own))).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(await buttonByLabel(labelOf(own)));
    await waitFor(() => expect(asked().get("order")).toBe("asc"));
    expect(asked().get("sort")).toBe(KEY[own]);
    expect(headerByLabel(labelOf(own))).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(await buttonByLabel(labelOf(own)));
    await waitFor(() => expect(asked().get("order")).toBe("desc"));
    expect(headerByLabel(labelOf(own))).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(await sortButton("size"));
    await waitFor(() => expect(asked().get("sort")).toBe("size"));
    expect(asked().get("order")).toBe("desc");
    expect(sortedLabels()).toEqual([t("documents.home.columns.size")]);
    expect(headerByLabel(labelOf(own))).toHaveAttribute("aria-sort", "none");
  });

  it("the workspace home has no screen column: Cập nhật is its default and the only arrow", async () => {
    serve();
    renderView();
    await screen.findByText("An");
    expect(lastQuery(listCalls()).get("sort")).toBe("updated");
    expect(lastQuery(listCalls()).get("order")).toBe("desc");
    expect(sortedLabels()).toEqual([t("documents.home.columns.updated")]);
  });

  it("Có gắn sao: the starred date descending by default, ordered on the client, no sort in the request", async () => {
    route({
      starred: () => [
        summary({ id: "s-old", kind: "file", title: "Cũ.docx", favorited_at: "2026-10-01T00:00:00Z" }),
        summary({ id: "s-new", kind: "file", title: "Mới.docx", favorited_at: "2026-10-05T00:00:00Z" }),
        summary({ id: "s-mid", kind: "file", title: "Giữa.docx", favorited_at: "2026-10-03T00:00:00Z" }),
      ],
    });
    renderView(`/org/${WS}/documents?view=starred`);
    await screen.findByText("Mới.docx");
    expect(rowOrder()).toEqual(["s-new", "s-mid", "s-old"]);
    expect(sortedLabels()).toEqual([labelOf("starred")]);
    expect(headerByLabel(labelOf("starred"))).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(await buttonByLabel(labelOf("starred")));
    await waitFor(() => expect(rowOrder()).toEqual(["s-old", "s-mid", "s-new"]));
    expect(headerByLabel(labelOf("starred"))).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(rowOrder()).toEqual(["s-old", "s-mid", "s-new"]));
    expect(sortedLabels()).toEqual([t("documents.home.columns.name")]);
    expect(listCalls().every((path) => !queryOf(path).get("sort"))).toBe(true);
  });

  it("Thùng rác: always deleted ascending, no header is a button, Đã xóa shows the order, the groups stay", async () => {
    route({
      list: () => [
        summary({ id: "t1", title: "Sắp xóa", archived_at: "2026-10-01T00:00:00Z", purge_after: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
        summary({ id: "t2", title: "Còn lâu", archived_at: "2026-10-18T00:00:00Z", purge_after: new Date(Date.now() + 20 * 86_400_000).toISOString() }),
      ],
    });
    renderView(`/org/${WS}/documents?view=archived`);
    await screen.findByText("Sắp xóa");
    expect(lastQuery(listCalls()).get("archived")).toBe("1");
    expect(lastQuery(listCalls()).get("sort")).toBe("deleted");
    expect(lastQuery(listCalls()).get("order")).toBe("asc");
    expect(screen.queryAllByRole("button", { name: /^Sắp xếp theo|^Sort by/ })).toHaveLength(0);
    // The one sorted header is the static Đã xóa (F1): aria-sort + arrow, no button.
    expect(sortedHeaders().map((th) => th.textContent)).toEqual(["Đã xóa"]);
    expect(sortedHeaders()[0]).toHaveAttribute("aria-sort", "ascending");
    expect(groupHeaders()).toHaveLength(2);
  });

  it("a column picked on Gần đây changes neither the home table nor Được chia sẻ với tôi, and each screen reads its own entry back", async () => {
    serve();
    const first = renderView(`/org/${WS}/documents?view=recent`);
    await screen.findByText("An");
    fireEvent.click(await sortButton("name"));
    await waitFor(() => expect(lastQuery(calls(recentUrl, true)).get("sort")).toBe("name"));
    expect(JSON.parse(defaultStorage.getItem("uniwork_documents_sort:u1")!)).toEqual({ recent: { column: "name", order: "asc" } });
    first.unmount();

    requestMock.mockClear();
    const home = renderView();
    await screen.findByText("An");
    expect(lastQuery(listCalls()).get("sort")).toBe("updated");
    expect(sortedLabels()).toEqual([t("documents.home.columns.updated")]);
    home.unmount();

    requestMock.mockClear();
    const shared = renderView(`/org/${WS}/documents?view=shared`);
    await screen.findByText("An");
    expect(lastQuery(calls(sharedUrl, true)).get("sort")).toBe("shared");
    expect(sortedLabels()).toEqual([labelOf("shared")]);
    shared.unmount();

    requestMock.mockClear();
    renderView(`/org/${WS}/documents?view=recent`);
    await screen.findByText("An");
    expect(lastQuery(calls(recentUrl, true)).get("sort")).toBe("name");
    expect(lastQuery(calls(recentUrl, true)).get("order")).toBe("asc");
    expect(sortedLabels()).toEqual([t("documents.home.columns.name")]);
  });

  it("an open folder shares the workspace entry with the home table", async () => {
    defaultStorage.setItem("uniwork_documents_sort:u1", JSON.stringify({ workspace: { column: "name", order: "asc" } }));
    route({
      tree: () => [{ id: "fo1", title: "Dự án CCB", kind: "folder", position: 0, children: [] }],
      detail: (id) => (id === "fo1" ? folderDetail() : null),
      list: (path) => (queryOf(path).get("parent_id") === "fo1" ? ROWS.map((r) => summary({ ...r, parent_id: "fo1" })) : []),
    });
    renderView(`/org/${WS}/documents?folder=fo1`);
    await screen.findByText("An");
    expect(rowOrder()).toEqual(["d-a", "d-b", "d-c"]);
    expect(sortedLabels()).toEqual([t("documents.home.columns.name")]);
  });

  it("reads the old single value once as the workspace entry; the other screens start from their own default", async () => {
    defaultStorage.setItem("uniwork_documents_sort:u1", JSON.stringify({ column: "size", order: "asc" }));
    serve();
    const home = renderView();
    await screen.findByText("An");
    expect(lastQuery(listCalls()).get("sort")).toBe("size");
    expect(lastQuery(listCalls()).get("order")).toBe("asc");
    expect(JSON.parse(defaultStorage.getItem("uniwork_documents_sort:u1")!)).toEqual({ workspace: { column: "size", order: "asc" } });
    home.unmount();
    requestMock.mockClear();
    renderView(`/org/${WS}/documents?view=recent`);
    await screen.findByText("An");
    expect(lastQuery(calls(recentUrl, true)).get("sort")).toBe("activity");
    expect(sortedLabels()).toEqual([labelOf("activity")]);
  });

  it("falls back to every screen's default when storage throws, and a click still sorts", async () => {
    const get = vi.spyOn(defaultStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const set = vi.spyOn(defaultStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      serve();
      renderView(`/org/${WS}/documents?view=recent`);
      await screen.findByText("An");
      expect(lastQuery(calls(recentUrl, true)).get("sort")).toBe("activity");
      expect(sortedLabels()).toEqual([labelOf("activity")]);
      fireEvent.click(await sortButton("name"));
      await waitFor(() => expect(lastQuery(calls(recentUrl, true)).get("sort")).toBe("name"));
      expect(sortedLabels()).toEqual([t("documents.home.columns.name")]);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  describe.each([
    { view: "recent", base: recentUrl, own: "activity", row: (id: string, title: string, at: string) => ({ id, title, last_activity: { kind: "edited", at } }) },
    { view: "shared", base: sharedUrl, own: "shared", row: (id: string, title: string, at: string) => ({ id, title, shared: { by: "u2", by_kind: "human", by_name: "Dũng", at } }) },
  ])("the date groups of $view", ({ view, base, own, row }) => {
    const rows = () => {
      const now = Date.now();
      return [
        row("g1", "Vừa xong", new Date(now - 60_000).toISOString()),
        row("g2", "Cũ hơn", "2024-01-05T00:00:00Z"),
      ].map((r) => summary(r));
    };
    const serveGroups = () =>
      requestMock.mockImplementation((path: string) => {
        const p = String(path);
        if (p.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
        if (p === FAVORITES_URL) return Promise.resolve({ favorites: [] });
        if (p.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
        if (p.split("?")[0] === base) return Promise.resolve({ documents: rows(), next_cursor: null });
        return Promise.resolve({ documents: [], next_cursor: null });
      });

    it("show while the screen column is sorted descending and go away under any other sort", async () => {
      serveGroups();
      renderView(`/org/${WS}/documents?view=${view}`);
      await screen.findAllByText("Vừa xong"); // the Mở tiếp card repeats a title (W14)
      expect(groupHeaders().length).toBeGreaterThan(0);

      fireEvent.click(await sortButton("name"));
      await waitFor(() => expect(groupHeaders()).toEqual([]));
      // The screen column again: descending is its own order, so the groups return.
      fireEvent.click(await buttonByLabel(labelOf(own)));
      await waitFor(() => expect(lastQuery(calls(base, true)).get("sort")).toBe(own));
      expect(lastQuery(calls(base, true)).get("order")).toBe("desc");
      await waitFor(() => expect(groupHeaders().length).toBeGreaterThan(0));
      // Ascending is the reverse of the groups' order: flat.
      fireEvent.click(await buttonByLabel(labelOf(own)));
      await waitFor(() => expect(lastQuery(calls(base, true)).get("order")).toBe("asc"));
      await waitFor(() => expect(groupHeaders()).toEqual([]));
    });
  });
});
