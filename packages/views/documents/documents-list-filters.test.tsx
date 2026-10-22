import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { pickTypeFilter, typeFilterSelect } from "../test/type-filter";
import { DocumentsPageView } from "./documents-page-view";

// LISTFILTER-01 (UNI-1868) and UNI-2045 W10: the type chips and Người sửa
// run on the server where a list pages there — `format`/`kind`/`updated_by`
// on the home root, recent and both shared lists — the trash has no filter
// bar, and the rows the server cannot filter (merged source files, starred,
// an open folder) keep the client predicates. The access filter is gone (Q6).

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
const listCalls = () =>
  requestMock.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith(LIST_BASE) && !path.startsWith(`${LIST_BASE}/sources`));
/** Picks "Người sửa: Tôi" in the filter bar. */
const pickEditorMe = async () => {
  fireEvent.click(await screen.findByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.editor")}`) }));
  const option = within(await screen.findByRole("listbox")).getByText(t("documents.home.filters.editor_me"));
  fireEvent.pointerDown(option);
  fireEvent.click(option);
};
const SCOPE_SIDEBAR: Record<string, string> = { home: "home", recent: "recent", shared: "shared", archived: "trash" };
/** Opens a scope through the sidebar nav (the scope tabs are gone, TRASH-01). */
const scopeTab = (key: string) =>
  screen.findAllByRole("button", { name: new RegExp(t(`documents.home.sidebar.${SCOPE_SIDEBAR[key] ?? key}`)) }).then((els) => els[0]!);

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

describe("server-side type and editor filters (UNI-1868, UNI-2045 W10)", () => {
  it("sends format on the home list, restarts at page 1 on a chip change, and never re-sends an old cursor", async () => {
    route({
      list: (path) => {
        const format = queryOf(path).get("format");
        if (format === "xlsx") return [file("x1", "Số liệu.xlsx")];
        if (format) return [];
        return queryOf(path).get("cursor") === "c2" ? [summary({ id: "d2", title: "Trang hai" })] : [summary(), file("f1", "Báo giá.docx")];
      },
      cursor: (path) => (queryOf(path).get("cursor") === "c2" || queryOf(path).get("format") ? null : "c2"),
    });
    renderView();
    await pickTypeFilter("xlsx");
    expect(await screen.findByText("Số liệu.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
    expect(screen.queryByText("Trang hai")).toBeNull();
    const filtered = listCalls().filter((path) => queryOf(path).get("format") === "xlsx");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((path) => !queryOf(path).get("cursor"))).toBe(true);
  });

  it("sends kind=page for the Trang chip and both filters together for chip + Người sửa", async () => {
    route({ list: () => [summary()] });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    // kind=page goes to the main list only.
    await pickTypeFilter("page");
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("kind") === "page")).toBe(true));

    fireEvent.click(await scopeTab("recent"));
    await pickTypeFilter("docx");
    await pickEditorMe();
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return path.startsWith(`${LIST_BASE}/recent`) && q.get("format") === "docx" && q.get("updated_by") === "u1";
        }),
      ).toBe(true),
    );
  });

  it("sends format and Người sửa on recent, shared-with-me and shared-by-me, and parent_id in an open folder", async () => {
    route({
      // Folder cards on home come from the tree, not the document list.
      tree: () => [{ id: "fo1", title: "Dự án CCB", kind: "folder", position: 0, children: [] }],
      detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
      list: (path) => {
        const format = queryOf(path).get("format");
        if (path.startsWith(`${LIST_BASE}/recent`)) return [format === "docx" ? file("r2", "Gần đây.docx") : summary({ id: "r1", title: "Mở gần đây" })];
        if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return [format === "docx" ? file("s2", "Chia sẻ.docx") : summary({ id: "s1", title: "Được chia sẻ" })];
        if (queryOf(path).get("shared_by_me") === "true") return [format === "docx" ? file("sbm2", "Tôi chia sẻ.docx") : summary({ id: "sbm1", title: "Tôi chia sẻ" })];
        if (queryOf(path).get("parent_id") === "fo1") return format === "xlsx" ? [file("in-x", "Trong thư mục.xlsx", { parent_id: "fo1" })] : [file("in-1", "Trong thư mục.docx", { parent_id: "fo1" })];
        return format === "docx" ? [file("f1", "Báo giá.docx")] : [summary({ id: "fo1", kind: "folder", title: "Dự án CCB" }), summary()];
      },
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(await scopeTab("recent"));
    await screen.findByText("Mở gần đây");
    await pickTypeFilter("docx");
    await waitFor(() =>
      expect(
        listCalls().some((path) => path.startsWith(`${LIST_BASE}/recent`) && queryOf(path).get("format") === "docx"),
      ).toBe(true),
    );
    expect(await screen.findByText("Gần đây.docx")).toBeInTheDocument();

    // A view switch resets the filters, so the shared-with-me pair is
    // picked on that view, not carried over.
    fireEvent.click(await scopeTab("shared"));
    await screen.findByText("Được chia sẻ");
    await pickTypeFilter("docx");
    await pickEditorMe();
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return path.startsWith(`${LIST_BASE}/shared-with-me`) && q.get("format") === "docx" && q.get("updated_by") === "u1";
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("Chia sẻ.docx")).toBeInTheDocument();

    fireEvent.click(await scopeTab("shared_by_me"));
    await screen.findByText("Tôi chia sẻ");
    await pickTypeFilter("docx");
    await pickEditorMe();
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return q.get("shared_by_me") === "true" && !q.has("parent_id") && q.get("format") === "docx" && q.get("updated_by") === "u1";
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("Tôi chia sẻ.docx")).toBeInTheDocument();

    // The open folder's list is the same endpoint keyed by parent_id; it is
    // loaded in full and filtered on the client, so parent_id is the only
    // param to assert.
    fireEvent.click(await scopeTab("home"));
    // The name appears on both the folder card and the sidebar tree; the
    // card is the clickable one here.
    fireEvent.click((await screen.findAllByText("Dự án CCB"))[0]!);
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("parent_id") === "fo1")).toBe(true));
  });

  const matchesScopeEndpoint = (path: string, endpoint: string) =>
    endpoint === "shared-by-me" ? queryOf(path).get("shared_by_me") === "true" : path.startsWith(`${LIST_BASE}/${endpoint}`);

  it.each([
    ["recent", "recent"],
    ["shared", "shared-with-me"],
    ["shared_by_me", "shared-by-me"],
  ])("keeps only pages under the Trang chip on %s, filtered on the client (no kind param exists there)", async (scope, endpoint) => {
    route({
      list: (path) => {
        if (!matchesScopeEndpoint(path, endpoint)) return [summary()];
        return [
          summary({ id: "p1", title: "Trang của tôi" }),
          file("f1", "Tệp của tôi.docx"),
          summary({ id: "fo9", kind: "folder", title: "Thư mục của tôi" }),
        ];
      },
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(await scopeTab(scope));
    await screen.findByText("Tệp của tôi.docx");
    await pickTypeFilter("page");
    // Rows narrowed: only the page survives; no kind/format is sent to this endpoint.
    const table = screen.getByRole("table");
    expect(await within(table).findByText("Trang của tôi")).toBeInTheDocument();
    expect(within(table).queryByText("Tệp của tôi.docx")).toBeNull();
    expect(within(table).queryByText("Thư mục của tôi")).toBeNull();
    const endpointCalls = listCalls().filter((path) => matchesScopeEndpoint(path, endpoint));
    expect(endpointCalls.every((path) => !queryOf(path).get("kind") && !queryOf(path).get("format"))).toBe(true);
  });

  it.each([
    ["recent", "recent"],
    ["shared", "shared-with-me"],
    ["shared_by_me", "shared-by-me"],
  ])("says 'in what is loaded' for an empty Trang result on %s while more pages wait", async (scope, endpoint) => {
    route({
      list: (path) => (matchesScopeEndpoint(path, endpoint) ? [file("f1", "Chỉ có tệp.docx")] : [summary()]),
      cursor: (path) => (matchesScopeEndpoint(path, endpoint) ? "more" : null),
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(await scopeTab(scope));
    await screen.findByText("Chỉ có tệp.docx");
    await pickTypeFilter("page");
    expect(await screen.findByText(t("documents.home.no_matches_more_description"))).toBeInTheDocument();
    expect(screen.queryByText("Chỉ có tệp.docx")).toBeNull();
  });

  it("sends no filter to the trash, and never carries one from another view", async () => {
    route({
      list: (path) => (queryOf(path).get("archived") === "1" ? [summary({ id: "tr1", title: "Xoá mềm" })] : [summary()]),
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    fireEvent.click(await scopeTab("recent"));
    await pickTypeFilter("docx");
    await pickEditorMe();
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("updated_by") === "u1")).toBe(true));

    fireEvent.click(await scopeTab("archived"));
    expect(await screen.findByText("Xoá mềm")).toBeInTheDocument();
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("archived") === "1")).toBe(true));
    for (const path of listCalls()) {
      const q = queryOf(path);
      if (q.get("archived") === "1") {
        expect([q.get("format"), q.get("access"), q.get("updated_by"), q.get("updated_from")]).toEqual([null, null, null, null]);
      }
    }
    // The trash view has no filter bar at all (UNI-2045 W10).
    expect(typeFilterSelect()).toBeNull();
  });

  it("keeps client filtering for merged source rows: the chip goes to the sources API, Người sửa never does", async () => {
    route({
      list: (path) => {
        const q = queryOf(path);
        const editor = q.get("updated_by");
        const format = q.get("format");
        // Emulate the server: only rows that survive both filters come back.
        return [summary({ id: "own", title: "Ghi chú của tôi", updated_by: "u1" }), file("f1", "Báo giá.docx", { updated_by: "u2" })].filter(
          (row) => (!editor || (row as Record<string, unknown>).updated_by === editor) && (!format || (row.kind === "file" && String(row.title).toLowerCase().endsWith(`.${format}`))),
        );
      },
      sources: (path) => (queryOf(path).get("type") === "docx" ? [source({ name: "Kèm.docx", extension: "docx" })] : [source()]),
    });
    renderView();
    await screen.findByText("Đề xuất ngân sách.pdf");

    await pickEditorMe();
    // Source rows have no server editor filter: the client drops them (their
    // owner is u2); the document rows were filtered on the server.
    await waitFor(() => expect(screen.queryByText("Đề xuất ngân sách.pdf")).toBeNull());
    expect(await screen.findByText("Ghi chú của tôi")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
    const sourceCallsList = requestMock.mock.calls.filter(([path]) => String(path).startsWith(`${LIST_BASE}/sources`));
    expect(sourceCallsList.every(([path]) => !queryOf(String(path)).get("updated_by"))).toBe(true);

    await pickTypeFilter("docx");
    // The chip reaches the sources API as `type`; the doc list sees `format`.
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path]) => String(path).startsWith(`${LIST_BASE}/sources`) && queryOf(String(path)).get("type") === "docx",
        ),
      ).toBe(true),
    );
    expect(listCalls().some((path) => queryOf(path).get("format") === "docx")).toBe(true);
  });

  it("keeps client filtering on starred: chips hide favorites without touching the list requests", async () => {
    route({
      list: () => [summary()],
      starred: () => [
        summary({ id: "star-docx", kind: "file", title: "Báo giá.docx" }),
        summary({ id: "star-pdf", kind: "file", title: "Hợp đồng.pdf" }),
      ],
    });
    renderView(`/org/${WS}/documents?view=starred`);
    expect(await screen.findByText("Báo giá.docx")).toBeInTheDocument();
    expect(await screen.findByText("Hợp đồng.pdf")).toBeInTheDocument();
    const callsBefore = listCalls().length;

    await pickTypeFilter("pdf");
    expect(await screen.findByText("Hợp đồng.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
    // No refetch for a client-only filter on this view, and the starred route takes no format.
    expect(listCalls().length).toBe(callsBefore);
    expect(requestMock.mock.calls.every(([path]) => !String(path).startsWith(`${LIST_BASE}/favorites?format`))).toBe(true);
    expect(listCalls().every((path) => !queryOf(path).get("format"))).toBe(true);
  });

  it("keeps the honest 'in what is loaded' copy for a client-filtered list that still has more", async () => {
    route({
      list: () => [],
      sources: () => [],
      sourcesCursor: () => "s2",
    });
    renderView(`/org/${WS}/documents?view=sources`);
    await screen.findByText(t("documents.home.views.sources"));
    await pickEditorMe();
    expect(await screen.findByText(t("documents.home.no_matches_filters_more_description"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.library.load_more") })).toBeInTheDocument();
  });

  it("shows a plain filtered-empty state for a server-filtered list, even while has_more holds", async () => {
    route({
      list: (path) => (queryOf(path).get("format") === "pdf" ? [] : [summary()]),
      // The filtered page came back full-or-empty but the server still reports more:
      // the copy must not say "in what has loaded" — the filter already ran.
      cursor: () => "more",
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    await pickTypeFilter("pdf");
    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.home.no_matches_more_description"))).toBeNull();
    expect(screen.queryByText(t("documents.home.no_matches_filters_more_description"))).toBeNull();
  });

  // (RESTORE-01's scope tabs carried an N+ count; the TRASH-01 sidebar shows
  //  counts only on starred, so that assertion has no surface here.)

  it("draws the server's format over the title's extension and falls back to a generic file for an unknown one", async () => {
    route({
      list: () => [
        // The title says .docx; the server read the MIME and says xlsx — the mark follows the server.
        file("srv", "Báo giá.docx", { format: "xlsx" }),
        file("ext", "Số liệu.xlsx"),
        file("weird", "Ghi chú", { format: "weird-format" }),
      ],
    });
    renderView();
    await screen.findByText("Báo giá.docx");

    const mark = (title: string, name: string) =>
      within(screen.getByText(title).closest("tr")! as HTMLElement).getByRole("img", { name });
    expect(mark("Báo giá.docx", t("documents.file_types.xlsx"))).toBeInTheDocument();
    expect(mark("Số liệu.xlsx", t("documents.file_types.xlsx"))).toBeInTheDocument();
    expect(mark("Ghi chú", t("documents.file_types.file"))).toBeInTheDocument();
  });
});
