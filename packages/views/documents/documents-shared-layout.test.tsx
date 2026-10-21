import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { defaultStorage } from "@uniwork/core/platform";
import type { User, Workspace } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { DocumentsPageView } from "./documents-page-view";

// UNI-2045 W14: Recent on the approved recent-canvas layout, and Home, My
// Folder, a folder and Ở nơi khác on the shared list layout (doclist-canvas).

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
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
    my_level: "manage",
    updated_at: ago(30),
    ...over,
  };
}

const recent = (id: string, title: string, kind: string, minutes: number) =>
  summary({
    id,
    title,
    kind: "file",
    organization_id: "org1",
    last_activity: { kind, at: ago(minutes) },
    file: { file_id: `file-${id}`, version_id: "v1", version: 1, filename: title, mime_type: "application/octet-stream", size_bytes: 10, checksum_sha256: "a".repeat(64) },
  });

function source() {
  return {
    id: "chat:m1",
    source: "chat",
    parent: { kind: "chat_channel", id: "c1", title: "Kênh chung" },
    name: "Đề xuất ngân sách.pdf",
    mime_type: "application/pdf",
    extension: "pdf",
    size_bytes: 2048,
    updated_at: ago(60),
    owner: { id: "u2", kind: "human", name: "Dũng" },
    can_open_in_app: false,
    can_save: true,
  };
}

interface Routes {
  tree?: () => unknown[];
  list?: (path: string) => unknown[];
  detail?: (id: string) => unknown;
  sources?: () => unknown[];
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: routes.tree?.() ?? [] });
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return Promise.resolve({ items: routes.sources?.() ?? [], next_cursor: null });
    }
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
      return Promise.resolve(doc ? { document: doc } : {});
    }
    if (path.startsWith(LIST_BASE) && method === "GET") {
      return Promise.resolve({ documents: routes.list?.(path) ?? [], next_cursor: null });
    }
    return Promise.resolve({});
  });
}

function renderView(initialUrl = "/", onOpen = vi.fn()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={sessionUser}>
        <FeatureFlagsProvider service={service}>
          <DocumentsPageView wsId={WS} onOpen={onOpen} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
      fakeNav(initialUrl),
    ),
  );
  return onOpen;
}

/** The visible column names in DOM order; Select and Actions carry only sr-only text. */
const headerTexts = () => Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
/** Read at assertion time: the session locale (vi) applies once the view mounts. */
const sharedColumns = () => ["select", "name", "access", "editor", "updated", "size", "actions"].map((id) => t(`documents.list.column.${id}`));

/** Every list screen's filter bar: the type chips, Người sửa, Cập nhật, in that order. */
async function expectSharedToolbar() {
  const chips = await screen.findByRole("group", { name: t("documents.home.chips_label") });
  const editor = screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.editor")}`) });
  const updated = screen.getByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.updated")}`) });
  expect(chips.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(editor.compareDocumentPosition(updated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  defaultStorage.removeItem("uniwork_documents_sort:u1");
  defaultStorage.removeItem("uniwork_documents_groups:u1");
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

describe("Recent on the approved recent-canvas layout (UNI-2045 W14)", () => {
  const rows = [
    recent("r3", "Báo cáo tháng 9.pptx", "opened", 60 * 26),
    recent("r1", "Đề xuất ngân sách Q4.docx", "edited", 5),
    recent("r5", "Hợp đồng mẫu.docx", "opened", 60 * 24 * 9),
    recent("r2", "Theo dõi chi phí.xlsx", "opened", 50),
    recent("r4", "Biên bản nghiệm thu.docx", "commented", 60 * 30),
  ];

  it("heads the page with its title, the 30-day subtitle and the search box, without the module header", async () => {
    route({ list: () => rows });
    renderView("/?view=recent");
    expect(await screen.findByRole("heading", { level: 1, name: t("documents.home.views.recent") })).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.view_subtitle.recent"))).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: t("documents.home.search.label") })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("documents.page.title") })).toBeNull();
  });

  it("shows the four latest documents by activity as Mở tiếp cards that open the document", async () => {
    route({ list: () => rows });
    const onOpen = renderView("/?view=recent");
    const section = await screen.findByRole("region", { name: t("documents.recent.continue_title") });
    const cards = within(section).getAllByRole("button");
    expect(cards.map((card) => card.getAttribute("data-document-id"))).toEqual(["r1", "r2", "r3", "r4"]);
    // A native button: Tab reaches it and Enter or Space opens it.
    expect(cards[0]!.tagName).toBe("BUTTON");
    expect(cards[0]).toHaveAccessibleName(new RegExp(`^Đề xuất ngân sách Q4\\.docx`));
    expect(within(cards[0]!).getByText(new RegExp(t("documents.list.activity.edited")))).toBeInTheDocument();
    fireEvent.click(cards[1]!);
    expect(onOpen).toHaveBeenCalledWith("r2");
  });

  it("shows the Mở tiếp cards only while Recent is in its own order: sorted by name there are none", async () => {
    route({ list: () => rows });
    renderView("/?view=recent");
    await screen.findByRole("region", { name: t("documents.recent.continue_title") });
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(`^${t("documents.home.sort.column", { column: t("documents.home.columns.name") })}`) }),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: t("documents.recent.continue_title") })).toBeNull());
  });

  it("hides the Mở tiếp row on an empty list and while a filter is on", async () => {
    route({ list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("format") === "pdf" ? [] : rows) });
    renderView("/?view=recent");
    await screen.findByRole("region", { name: t("documents.recent.continue_title") });
    const chips = screen.getByRole("group", { name: t("documents.home.chips_label") });
    fireEvent.click(within(chips).getByRole("button", { name: t("documents.home.chips.docx") }));
    await waitFor(() => expect(screen.queryByRole("region", { name: t("documents.recent.continue_title") })).toBeNull());
  });

  it("has no Mở tiếp row when nothing was opened yet", async () => {
    route({ list: () => [] });
    renderView("/?view=recent");
    await screen.findByText(t("documents.home.empty.recent_title"));
    expect(screen.queryByRole("region", { name: t("documents.recent.continue_title") })).toBeNull();
  });

  it("leads the toolbar with the Tất cả / Đã mở / Đã sửa segment as a radio group, then chips, Người sửa, Cập nhật", async () => {
    route({ list: () => rows });
    renderView("/?view=recent");
    const segment = await screen.findByRole("radiogroup", { name: t("documents.home.filters.activity_label") });
    const radios = within(segment).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["all", "opened", "edited"].map((v) => t(`documents.home.filters.activity_${v}`)));
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    const chips = screen.getByRole("group", { name: t("documents.home.chips_label") });
    expect(segment.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await expectSharedToolbar();
    fireEvent.click(radios[2]!);
    await waitFor(() => expect(within(segment).getAllByRole("radio")[2]).toHaveAttribute("aria-checked", "true"));
  });

  it("keeps the doclist columns: Select · Name · Lần mở gần nhất · Access · Last edited by · Updated · Size · Actions", async () => {
    route({ list: () => rows });
    renderView("/?view=recent");
    await screen.findByRole("table");
    expect(headerTexts()).toEqual([...sharedColumns().slice(0, 2), t("documents.list.screen_column.activity"), ...sharedColumns().slice(2)]);
  });
});

describe("Home, My Folder, a folder and Ở nơi khác on the shared list layout (UNI-2045 W14)", () => {
  const folder = (over: Record<string, unknown> = {}) => ({
    id: "fo1",
    workspace_id: WS,
    kind: "folder",
    title: "Dự án CCB",
    revision: "1",
    my_level: "manage",
    visibility: "workspace",
    breadcrumbs: [{ id: "fo1", title: "Dự án CCB" }],
    created_at: ago(90),
    updated_at: ago(90),
    ...over,
  });

  it("Home: the shared columns, toolbar and a selectable table, with the Home header and Tạo nhanh row kept", async () => {
    route({ list: () => [summary()] });
    renderView("/");
    await screen.findByText("Kế hoạch Q4");
    expect(headerTexts()).toEqual(sharedColumns());
    await expectSharedToolbar();
    expect(screen.getByRole("checkbox", { name: t("documents.list.bulk.select_all") })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: t("documents.home.sidebar.home") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("documents.home.quick_create.label") })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t("documents.recent.continue_title") })).toBeNull();
  });

  it.each([
    ["My Folder", { system_kind: "my_folder", title: "" }],
    ["a folder", {}],
  ])("%s: the shared columns, toolbar and a selectable table under the breadcrumb", async (_name, over) => {
    route({
      list: () => [summary({ id: "d2", title: "Ghi chú họp", parent_id: "fo1" })],
      detail: () => folder(over),
    });
    renderView("/?folder=fo1");
    await screen.findByText("Ghi chú họp");
    expect(screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") })).toBeInTheDocument();
    expect(headerTexts()).toEqual(sharedColumns());
    await expectSharedToolbar();
    expect(screen.getByRole("checkbox", { name: t("documents.list.bulk.select_all") })).toBeInTheDocument();
  });

  it("Ở nơi khác: the page head, the shared columns (no screen column) and toolbar; no Select (a source row has no bulk action)", async () => {
    route({ list: () => [], sources: () => [source()] });
    renderView("/?view=sources&source=chat");
    await screen.findByText("Đề xuất ngân sách.pdf");
    expect(screen.getByRole("heading", { level: 1, name: t("documents.home.views.chat") })).toBeInTheDocument();
    expect(screen.getByText(t("documents.home.view_subtitle.sources"))).toBeInTheDocument();
    expect(headerTexts()).toEqual(sharedColumns().slice(1));
    await expectSharedToolbar();
    expect(screen.queryByRole("checkbox", { name: t("documents.list.bulk.select_all") })).toBeNull();
  });
});
