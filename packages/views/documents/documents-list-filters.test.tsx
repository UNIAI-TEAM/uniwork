import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// LISTFILTER-01 (UNI-1868): the type chips and the access filter run on the
// server now — the library sends `format`/`access`/`kind` on every document
// list (home, folder, recent, shared, trash), the trash only ever sends
// `format` and `access=restricted`, and the rows the server cannot filter
// (merged source files, starred) keep the client predicates.

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

function favorite(over: Record<string, unknown> = {}) {
  return { document_id: "fav-1", workspace_id: WS, title: "Báo giá.docx", kind: "file", ...over };
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  cursor?: (path: string) => string | null;
  sources?: (path: string) => unknown[];
  sourcesCursor?: (path: string) => string | null;
  favorites?: () => unknown[];
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
const chipGroup = () => screen.getByRole("group", { name: t("documents.home.chips_label") });
const clickChip = (key: string) =>
  fireEvent.click(
    within(chipGroup()).getByRole("button", {
      name: t(`documents.home.chips.${key}`),
    }),
  );
const accessGroup = () => screen.getByRole("group", { name: t("documents.home.access_filter_label") });
const clickAccess = (key: string) =>
  fireEvent.click(
    within(accessGroup()).getByRole("button", {
      name: t(`documents.home.access_filters.${key}`),
    }),
  );
const scopeTab = (key: string) => screen.findByRole("tab", { name: new RegExp(t(`documents.home.scope.${key}`)) });

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

describe("server-side type and access filters (UNI-1868)", () => {
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
    clickChip("xlsx");
    expect(await screen.findByText("Số liệu.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
    expect(screen.queryByText("Trang hai")).toBeNull();
    const filtered = listCalls().filter((path) => queryOf(path).get("format") === "xlsx");
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((path) => !queryOf(path).get("cursor"))).toBe(true);
  });

  it("sends kind=page for the Trang chip and both filters together for chip + access", async () => {
    route({ list: () => [summary()] });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    clickChip("page");
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("kind") === "page")).toBe(true));

    clickChip("docx");
    clickAccess("edit");
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return q.get("format") === "docx" && q.get("access") === "edit";
        }),
      ).toBe(true),
    );
    // The Trang chip carried the access filter too (kind=page + access is legal).
    clickChip("page");
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return q.get("kind") === "page" && q.get("access") === "edit";
        }),
      ).toBe(true),
    );
  });

  it("sends format and access on recent and shared-with-me, and format + parent_id in an open folder", async () => {
    route({
      detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
      list: (path) => {
        const format = queryOf(path).get("format");
        if (path.startsWith(`${LIST_BASE}/recent`)) return [format === "docx" ? file("r2", "Gần đây.docx") : summary({ id: "r1", title: "Mở gần đây" })];
        if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return [format === "docx" ? file("s2", "Chia sẻ.docx") : summary({ id: "s1", title: "Được chia sẻ" })];
        if (queryOf(path).get("parent_id") === "fo1") return format === "xlsx" ? [file("in-x", "Trong thư mục.xlsx", { parent_id: "fo1" })] : [file("in-1", "Trong thư mục.docx", { parent_id: "fo1" })];
        return format === "docx" ? [file("f1", "Báo giá.docx")] : [summary({ id: "fo1", kind: "folder", title: "Dự án CCB" }), summary()];
      },
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(await scopeTab("recent"));
    await screen.findByText("Mở gần đây");
    clickChip("docx");
    await waitFor(() =>
      expect(
        listCalls().some((path) => path.startsWith(`${LIST_BASE}/recent`) && queryOf(path).get("format") === "docx"),
      ).toBe(true),
    );
    expect(await screen.findByText("Gần đây.docx")).toBeInTheDocument();

    clickAccess("manage");
    fireEvent.click(await scopeTab("shared"));
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return path.startsWith(`${LIST_BASE}/shared-with-me`) && q.get("format") === "docx" && q.get("access") === "manage";
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("Chia sẻ.docx")).toBeInTheDocument();

    // The open folder's list is the same endpoint: format + parent_id (access persists).
    clickChip("xlsx");
    fireEvent.click(await scopeTab("home"));
    await screen.findByText("Dự án CCB");
    fireEvent.click(await screen.findByText("Dự án CCB"));
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return q.get("parent_id") === "fo1" && q.get("format") === "xlsx" && q.get("access") === "manage";
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("Trong thư mục.xlsx")).toBeInTheDocument();
  });

  it.each([
    ["recent", "recent"],
    ["shared", "shared-with-me"],
  ])("keeps only pages under the Trang chip on %s, filtered on the client (no kind param exists there)", async (scope, endpoint) => {
    route({
      list: (path) => {
        if (!path.startsWith(`${LIST_BASE}/${endpoint}`)) return [summary()];
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
    clickChip("page");
    // Rows narrowed: only the page survives; no kind/format is sent to this endpoint.
    expect(await screen.findByText("Trang của tôi")).toBeInTheDocument();
    expect(screen.queryByText("Tệp của tôi.docx")).toBeNull();
    expect(screen.queryByText("Thư mục của tôi")).toBeNull();
    const endpointCalls = listCalls().filter((path) => path.startsWith(`${LIST_BASE}/${endpoint}`));
    expect(endpointCalls.every((path) => !queryOf(path).get("kind") && !queryOf(path).get("format"))).toBe(true);
  });

  it.each([
    ["recent", "recent"],
    ["shared", "shared-with-me"],
  ])("says 'in what is loaded' for an empty Trang result on %s while more pages wait", async (scope, endpoint) => {
    route({
      list: (path) => (path.startsWith(`${LIST_BASE}/${endpoint}`) ? [file("f1", "Chỉ có tệp.docx")] : [summary()]),
      cursor: (path) => (path.startsWith(`${LIST_BASE}/${endpoint}`) ? "more" : null),
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(await scopeTab(scope));
    await screen.findByText("Chỉ có tệp.docx");
    clickChip("page");
    expect(await screen.findByText(t("documents.home.no_matches_more_description"))).toBeInTheDocument();
    expect(screen.queryByText("Chỉ có tệp.docx")).toBeNull();
  });

  it("trash hides manage/edit, sends only format and access=restricted, and never carries a stale access from another tab", async () => {
    route({
      list: (path) => {
        const q = queryOf(path);
        if (q.get("archived") === "1") return q.get("access") === "restricted" ? [file("tr2", "Đã xoá.docx", { visibility: "restricted" })] : [summary({ id: "tr1", title: "Xoá mềm" })];
        return [summary()];
      },
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    clickAccess("manage");
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("access") === "manage")).toBe(true));

    fireEvent.click(await scopeTab("archived"));
    expect(await screen.findByText("Xoá mềm")).toBeInTheDocument();
    // The trash request must not inherit manage: the server would 400 it.
    await waitFor(() => expect(listCalls().some((path) => queryOf(path).get("archived") === "1")).toBe(true));
    for (const path of listCalls()) {
      const q = queryOf(path);
      if (q.get("archived") === "1") {
        expect(q.get("access") === "manage" || q.get("access") === "edit").toBe(false);
      }
    }
    // Only the options the trash accepts are offered.
    const buttons = within(accessGroup()).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual([
      t("documents.home.access_filters.all"),
      t("documents.home.access_filters.restricted"),
    ]);

    clickAccess("restricted");
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return q.get("archived") === "1" && q.get("access") === "restricted";
        }),
      ).toBe(true),
    );
    expect(await screen.findByText("Đã xoá.docx")).toBeInTheDocument();
    // Format still applies on the trash.
    clickChip("docx");
    await waitFor(() =>
      expect(
        listCalls().some((path) => {
          const q = queryOf(path);
          return q.get("archived") === "1" && q.get("format") === "docx";
        }),
      ).toBe(true),
    );
  });

  it("keeps client filtering for merged source rows: the chip goes to the sources API, access never does", async () => {
    route({
      list: (path) => {
        const q = queryOf(path);
        const access = q.get("access");
        const format = q.get("format");
        // Emulate the server: only rows that survive both filters come back.
        return [summary({ id: "own", title: "Ghi chú quản lý", my_level: "manage" }), file("f1", "Báo giá.docx")].filter(
          (row) =>
            (access !== "manage" || row.my_level === "manage") &&
            (!format || (row.kind === "file" && String(row.title).toLowerCase().endsWith(`.${format}`))),
        );
      },
      sources: (path) => (queryOf(path).get("type") === "docx" ? [source({ name: "Kèm.docx", extension: "docx" })] : [source()]),
    });
    renderView();
    await screen.findByText("Đề xuất ngân sách.pdf");

    clickAccess("manage");
    // Source rows have no server access filter: the client drops them; the
    // document rows were filtered on the server (Báo giá.docx is edit-only).
    await waitFor(() => expect(screen.queryByText("Đề xuất ngân sách.pdf")).toBeNull());
    // The doc row re-appears when the server's filtered answer lands.
    expect(await screen.findByText("Ghi chú quản lý")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
    const sourceCallsList = requestMock.mock.calls.filter(([path]) => String(path).startsWith(`${LIST_BASE}/sources`));
    expect(sourceCallsList.every(([path]) => !queryOf(String(path)).get("access"))).toBe(true);

    clickChip("docx");
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
      favorites: () => [favorite({ document_id: "star-docx", title: "Báo giá.docx" }), favorite({ document_id: "star-pdf", title: "Hợp đồng.pdf", kind: "file" })],
    });
    renderView(`/org/${WS}/documents?view=starred`);
    expect(await screen.findByText("Báo giá.docx")).toBeInTheDocument();
    expect(await screen.findByText("Hợp đồng.pdf")).toBeInTheDocument();
    const callsBefore = listCalls().length;

    clickChip("pdf");
    expect(await screen.findByText("Hợp đồng.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
    // No refetch for a client-only filter on this view.
    expect(listCalls().length).toBe(callsBefore);
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
    clickAccess("manage");
    expect(await screen.findByText(t("documents.home.no_matches_access_more_description"))).toBeInTheDocument();
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

    clickChip("pdf");
    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.home.no_matches_more_description"))).toBeNull();
    expect(screen.queryByText(t("documents.home.no_matches_access_more_description"))).toBeNull();
    expect(screen.queryByText(t("documents.home.no_matches_filters_more_description"))).toBeNull();
  });

  it("shows the active scope count as N+ while the server has more, N once exhausted", async () => {
    route({
      list: (path) => (queryOf(path).get("cursor") === "c2" ? [summary({ id: "d2", title: "Trang hai" })] : [summary()]),
      cursor: (path) => (queryOf(path).get("cursor") === "c2" ? null : "c2"),
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    const tab = screen.getByRole("tab", { name: new RegExp(t("documents.home.scope.home")) });
    expect(within(tab).getByText("1+")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    await screen.findByText("Trang hai");
    expect(within(tab).getByText("2")).toBeInTheDocument();
    expect(within(tab).queryByText("2+")).toBeNull();
  });

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
