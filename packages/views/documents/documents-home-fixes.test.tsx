import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { documentRow } from "./library-rows";
import { favoriteRow } from "./starred-rows";

// Review fixes for the Documents home (UNI-1305 review-fe r1): the type chip
// that can reach the next page, the sidebar that does not flicker, the folder
// create and rename that submit once, the header count, the starred rows.

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

function renderView() {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
      </FeatureFlagsProvider>,
    ),
  );
}

function summary(over: Record<string, unknown> = {}) {
  return { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch Q4", revision: "1", updated_at: "2026-09-28T03:00:00Z", ...over };
}

function file(id: string, title: string, over: Record<string, unknown> = {}) {
  return summary({ id, kind: "file", title, organization_id: "org1", current_version: 1, my_level: "edit", ...over });
}

function folderDetail(over: Record<string, unknown> = {}) {
  return summary({ id: "fo1", kind: "folder", title: "Dự án CCB", revision: "3", my_level: "manage", breadcrumbs: [], ...over });
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
  /** Rows, or a promise to hold the answer back. */
  sources?: (path: string) => unknown[] | Promise<never>;
  detail?: (id: string) => unknown;
  post?: (path: string) => unknown;
  patch?: () => unknown;
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
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      const items = routes.sources?.(path) ?? [];
      return Array.isArray(items) ? Promise.resolve({ items, next_cursor: null }) : items;
    }
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (method === "PATCH") return run(() => routes.patch?.() ?? {});
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

const queryOf = (path: string) => new URLSearchParams(path.split("?")[1] ?? "");
const writes = (method: string) =>
  requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === method);

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

describe("type chip over paged lists (M2)", () => {
  it("offers Load more instead of a dead end, and shows the match from the next page", async () => {
    route({
      list: (path) => (queryOf(path).get("cursor") === "c2" ? [file("f2", "Số liệu.xlsx")] : [summary(), file("f1", "Báo giá.docx")]),
      cursor: (path) => (queryOf(path).get("cursor") === "c2" ? null : "c2"),
    });
    renderView();
    await screen.findByText("Báo giá.docx");

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.xlsx") }));
    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.no_matches_more_description"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    expect(await screen.findByText("Số liệu.xlsx")).toBeInTheDocument();
    expect(screen.queryByText(t("documents.library.no_matches_title"))).toBeNull();
  });

  it("points at the create cards when they are on screen, and offers no Load more once exhausted", async () => {
    route({ list: () => [summary()] });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.pdf") }));
    expect(await screen.findByText(t("documents.home.no_matches_description"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.library.load_more") })).toBeNull();
  });
});

describe("sidebar sources section (m2)", () => {
  it("stays while a chip change reloads the sources, instead of flickering away", async () => {
    route({
      list: () => [summary(), file("f1", "Báo giá.docx")],
      sources: (path) => (queryOf(path).get("type") ? new Promise<never>(() => undefined) : [source()]),
    });
    renderView();
    expect(await screen.findByText(t("documents.home.sidebar.elsewhere"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.docx") }));
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => queryOf(String(path)).get("type") === "docx")).toBe(true));
    expect(screen.getByText(t("documents.home.sidebar.elsewhere"))).toBeInTheDocument();
  });
});

describe("new folder (m3)", () => {
  it("creates one folder on a double click and holds the control until the server answers", async () => {
    let answer: (value: unknown) => void = () => undefined;
    route({
      list: () => [],
      detail: () => folderDetail({ id: "fo9" }),
      post: () => new Promise((resolve) => { answer = resolve; }),
    });
    renderView();
    const add = await screen.findByRole("button", { name: t("documents.home.folders.new") });

    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(() => expect(add).toHaveAttribute("aria-disabled", "true"));
    expect(writes("POST")).toHaveLength(1);
    const headers = (writes("POST")[0]?.[1] as { headers?: Record<string, string> }).headers;
    expect(headers?.["Idempotency-Key"]).toBeTruthy();

    answer({ document: folderDetail({ id: "fo9", title: t("documents.home.folders.default_name") }) });
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(writes("POST")).toHaveLength(1);
  });
});

describe("folder rename (m4)", () => {
  async function openRename() {
    route({
      tree: () => [{ id: "fo1", title: "Dự án CCB", kind: "folder", position: 0, children: [] }],
      list: (path) => (queryOf(path).get("parent_id") === "fo1" ? [] : [summary({ id: "fo1", kind: "folder", title: "Dự án CCB" })]),
      detail: (id) => (id === "fo1" ? folderDetail() : null),
      patch: () => ({ document: folderDetail({ title: "CCB 2027", revision: "4" }) }),
    });
    renderView();
    fireEvent.click(await within(await screen.findByRole("table")).findByText("Dự án CCB"));
    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    fireEvent.click(within(crumbs).getByRole("button", { name: t("documents.home.folders.rename") }));
    return within(crumbs).getByRole("textbox", { name: t("documents.home.folders.rename_label") });
  }

  it("submits once when Enter is followed by the blur that removing the input causes", async () => {
    const input = await openRename();
    fireEvent.change(input, { target: { value: "CCB 2027" } });
    fireEvent.submit(input);
    fireEvent.blur(input);
    await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
    expect(writes("PATCH")).toHaveLength(1);
  });

  it("does not commit the draft when Escape cancels it", async () => {
    const input = await openRename();
    fireEvent.change(input, { target: { value: "CCB 2027" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: t("documents.home.folders.rename_label") })).toBeNull());
    expect(writes("PATCH")).toHaveLength(0);
  });
});

describe("header count (m9, visual r1)", () => {
  it("counts the rows the list shows, folders and linked files included, like the tab", async () => {
    route({
      list: () => [summary(), summary({ id: "d2", title: "Biên bản" }), summary({ id: "fo1", kind: "folder", title: "Hợp đồng" })],
      sources: () => [source()],
    });
    renderView();
    await screen.findByText("Đề xuất ngân sách.pdf");
    const heading = screen.getByRole("heading", { level: 1, name: t("documents.page.title") });
    expect(heading.parentElement).toHaveTextContent(new RegExp(`${t("documents.page.title")}4$`));
  });
});

describe("starred rows without a loaded copy (m1)", () => {
  const handlers: LibraryRowHandlers = {
    onOpen: vi.fn(),
    onFolder: vi.fn(),
    onGoToSource: vi.fn(),
    onDownloadSource: vi.fn(),
    onSaveSource: vi.fn(),
    isStarred: () => true,
    personName: () => null,
    desktopOpen: (doc) => ({ deploymentId: "dep-1", savedVersion: doc.current_version }),
  };
  const fav = { document_id: "f1", workspace_id: WS, title: "Báo giá.docx", kind: "file" };

  function renderRow(known?: Parameters<typeof favoriteRow>[1]) {
    render(
      <table>
        <tbody>
          <LibraryRowView row={documentRow(favoriteRow(fav, known))} handlers={handlers} archived={false} />
        </tbody>
      </table>,
    );
  }

  it("offers no app action until the document is known", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: t("office.desktop.row_action") })).toBeNull();
  });

  it("offers it once a loaded copy gives the organisation and version", () => {
    renderRow({ id: "f1", organization_id: "org1", current_version: 2 });
    expect(screen.getByRole("button", { name: t("office.desktop.row_action") })).toBeInTheDocument();
  });
});
