import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { pickTypeFilter, typeChipRemove, typeFilterSelect } from "../../test/type-filter";
import { DocumentsPageView } from "../documents-page-view";

// UNI-2045 W10 + W11 on the real page: one filter bar, in one order, on every
// list screen but Thùng rác (Loại: Tất cả … .txt, Người sửa, Cập nhật; Gần đây
// adds Tất cả / Đã mở / Đã sửa), no Truy cập and no Nhóm theo (Q6); the
// filters reach the server where the list pages there and run on the client
// where it is loaded in full. Gần đây, Được chia sẻ với tôi and Thùng rác
// group by date while in their own order, with collapse remembered per user
// and screen.

const { t } = initI18n();

const WS = "ws1";
const ORG = "o1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const FAVORITES_URL = `/api/v1/orgs/${ORG}/documents/favorites`;
const MEMBERS_URL = `/api/v1/workspaces/${WS}/members`;
const GROUPS_KEY = "uniwork_documents_groups:u1";

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

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();

function summary(id: string, over: Record<string, unknown> = {}) {
  return { id, workspace_id: WS, kind: "page", title: id, revision: "1", my_level: "manage", updated_at: ago(5), updated_by: "u1", ...over };
}
const txtFile = (id: string, over: Record<string, unknown> = {}) =>
  summary(id, { kind: "file", title: `${id}.txt`, format: "txt", current_version: 1, organization_id: ORG, ...over });

interface Routes {
  list?: (path: string) => unknown[];
  starred?: () => unknown[];
  tree?: () => unknown[];
  detail?: (id: string) => unknown;
}

function route(routes: Routes) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: routes.tree?.() ?? [] });
    if (path === FAVORITES_URL) return Promise.resolve({ favorites: [] });
    if (path.startsWith(MEMBERS_URL)) {
      return Promise.resolve({ members: [{ workspace_id: WS, user_id: "u2", display_name: "Bình", role: "member", email: "b@acme.vn" }] });
    }
    if (path.startsWith(`${LIST_BASE}/favorites`)) return Promise.resolve({ documents: routes.starred?.() ?? [], next_cursor: null });
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") return Promise.resolve({ items: [], next_cursor: null });
    if (path.startsWith("/api/v1/documents/") && method === "GET") {
      const doc = routes.detail?.(path.split("/")[4]?.split("?")[0] ?? "");
      return Promise.resolve(doc ? { document: doc } : {});
    }
    if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: routes.list?.(path) ?? [], next_cursor: null });
    return Promise.resolve({});
  });
}

const queryOf = (path: string) => new URLSearchParams(String(path).split("?")[1] ?? "");
const listCalls = (prefix = LIST_BASE) =>
  requestMock.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(prefix) && !path.startsWith(`${LIST_BASE}/sources`));
const lastCall = (match: (path: string) => boolean) => listCalls().filter(match).at(-1) ?? "";

/** page-a, notes.txt, sheet.xlsx; a request is answered the way the server would (the repeated type=). */
function mixedRows(path: string) {
  const query = queryOf(path);
  const rows: Record<string, unknown>[] = [summary("page-a"), txtFile("notes"), summary("sheet", { kind: "file", title: "sheet.xlsx", format: "xlsx", current_version: 1, organization_id: ORG })];
  const wanted = query.getAll("type");
  return wanted.length === 0 ? rows : rows.filter((row) => wanted.includes(row.kind === "page" ? "page" : String(row.format)));
}

const CHIP_LABELS = ["Tất cả", "UniNote", ".docx", ".xlsx", ".pptx", ".pdf", ".md", ".html", ".txt"];
const editorSelect = () => screen.queryByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.editor")}`) });
const updatedSelect = () => screen.queryByRole("combobox", { name: new RegExp(`^${t("documents.home.filters.updated")}`) });
const activityGroup = () => screen.queryByRole("radiogroup", { name: t("documents.home.filters.activity_label") });
/** The table alone: the Mở tiếp cards above it repeat a recent title (W14). */
const inTable = () => within(screen.getByRole("table"));

async function choose(combobox: HTMLElement, label: string) {
  fireEvent.click(combobox);
  const option = within(await screen.findByRole("listbox")).getByText(label);
  // Base UI only commits a click that started on the item with a pointer.
  fireEvent.pointerDown(option);
  fireEvent.click(option);
}

function expectOneFilterBar(opts: { segment: boolean }) {
  const type = typeFilterSelect();
  expect(type).not.toBeNull();
  // The chip row is gone: no type is a button of the bar any more.
  expect(screen.queryByRole("button", { name: ".docx" })).toBeNull();
  expect(editorSelect()).not.toBeNull();
  expect(updatedSelect()).not.toBeNull();
  // Loại comes first, then Người sửa, then Cập nhật, in document order.
  expect(type!.compareDocumentPosition(editorSelect()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(editorSelect()!.compareDocumentPosition(updatedSelect()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(activityGroup() !== null).toBe(opts.segment);
  // Q6: no Truy cập filter and no Nhóm theo select anywhere.
  expect(screen.queryByText("Nhóm theo")).toBeNull();
  expect(screen.queryByText("Quyền")).toBeNull();
  expect(screen.queryByRole("button", { name: "Tôi quản lý" })).toBeNull();
}

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, email: "an@example.com" });
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("one filter bar (W10)", () => {
  it("offers Tất cả and every type in one Loại menu, in order, each type with its icon (UNI-2113 r2)", async () => {
    route({ list: () => [summary("r-home")] });
    renderView();
    await screen.findByText("r-home");
    const trigger = typeFilterSelect()!;
    expect(trigger).toHaveTextContent(`${t("documents.home.filters.type")}: Tất cả`);
    expect(trigger.querySelector("svg:not(:last-child)")).toBeNull();
    fireEvent.click(trigger);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(CHIP_LABELS);
    // Tất cả is the checked item while nothing is picked.
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["true", ...Array(8).fill("false")]);
    // Every type but Tất cả carries its mark, hidden from assistive tech: the label names it.
    for (const option of options.slice(1)) {
      expect(option.querySelector("svg")).not.toBeNull();
      expect(option.querySelector("[role='img']")).toBeNull();
    }
    expect(screen.queryByTestId("type-chip-xlsx")).toBeNull();
  });

  it("shows one picked type in the trigger (with its mark) and as a chip", async () => {
    route({ list: () => [summary("r-home")] });
    renderView();
    await screen.findByText("r-home");
    await pickTypeFilter("xlsx");
    await waitFor(() => expect(typeFilterSelect()).toHaveTextContent(`${t("documents.home.filters.type")}: .xlsx`));
    expect(typeFilterSelect()!.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("type-chip-xlsx")).toHaveTextContent(".xlsx");
    expect(typeChipRemove("xlsx")).not.toBeNull();
    expect(queryOf(lastCall((path) => path.startsWith(LIST_BASE))).getAll("type")).toEqual(["xlsx"]);
  });

  it("picking two types shows the count in the trigger and two chips, and narrows the list (sent as the repeated type=, answered by the server)", async () => {
    route({ list: mixedRows });
    renderView();
    await screen.findByText("page-a");
    // Menu order, not click order: .xlsx then UniNote still reads UniNote, .xlsx.
    await pickTypeFilter("xlsx", "page");
    await waitFor(() => expect(typeFilterSelect()).toHaveTextContent(`${t("documents.home.filters.type")}: ${t("documents.home.filters.type_count", { count: 2 })}`));
    expect(typeFilterSelect()!.querySelector("svg:not(:last-child)")).toBeNull();
    const chips = screen.getAllByTestId(/^type-chip-/).map((chip) => chip.textContent);
    expect(chips).toEqual(["UniNote", ".xlsx"]);
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
    expect(screen.getByText("page-a")).toBeInTheDocument();
    expect(screen.getByText("sheet.xlsx")).toBeInTheDocument();
    // The last request carries both picks, as the repeated type, and no format or kind.
    const last = queryOf(lastCall((path) => path.startsWith(LIST_BASE)));
    expect([last.getAll("type"), last.has("format"), last.has("kind")]).toEqual([["page", "xlsx"].sort(), false, false]);
  });

  it("the x of a chip drops that one type; Tất cả clears every pick", async () => {
    route({ list: mixedRows });
    renderView();
    await screen.findByText("page-a");
    await pickTypeFilter("xlsx", "page", "txt");
    await waitFor(() => expect(screen.getAllByTestId(/^type-chip-/)).toHaveLength(3));
    expect(typeFilterSelect()).toHaveTextContent(t("documents.home.filters.type_count", { count: 3 }));

    fireEvent.click(typeChipRemove("page")!);
    await waitFor(() => expect(screen.queryByTestId("type-chip-page")).toBeNull());
    expect(screen.getAllByTestId(/^type-chip-/)).toHaveLength(2);
    expect(typeFilterSelect()).toHaveTextContent(t("documents.home.filters.type_count", { count: 2 }));
    // Focus goes back to the trigger, not to the page.
    expect(typeFilterSelect()).toHaveFocus();
    await waitFor(() => expect(screen.queryByText("page-a")).toBeNull());

    fireEvent.click(typeChipRemove("txt")!);
    await waitFor(() => expect(typeFilterSelect()).toHaveTextContent(`${t("documents.home.filters.type")}: .xlsx`));
    expect(await screen.findByText("sheet.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("notes.txt")).toBeNull();

    await pickTypeFilter("page");
    await waitFor(() => expect(screen.getAllByTestId(/^type-chip-/)).toHaveLength(2));
    await pickTypeFilter("all");
    await waitFor(() => expect(screen.queryAllByTestId(/^type-chip-/)).toHaveLength(0));
    expect(typeFilterSelect()).toHaveTextContent(`${t("documents.home.filters.type")}: Tất cả`);
    await screen.findByText("notes.txt");
    expect(screen.getByText("page-a")).toBeInTheDocument();
  });

  it.each([
    ["home root", undefined, "r-home"],
    ["Gần đây", "/?view=recent", "r-recent"],
    ["Có gắn sao", "/?view=starred", "r-starred"],
    ["Được chia sẻ với tôi", "/?view=shared", "r-shared"],
    ["Tôi đã chia sẻ", "/?view=shared-by-me", "r-sbm"],
    ["Lưu trữ", "/?view=shelved", "r-shelved"],
    ["a folder", "/?folder=fo1", "r-folder"],
  ])("draws the same bar on %s, the segment only on Gần đây", async (_name, url, title) => {
    route({
      list: () => [summary(title, { parent_id: url?.includes("folder") ? "fo1" : undefined, shelved_at: url?.includes("shelved") ? ago(60) : undefined })],
      starred: () => [summary(title, { favorited_at: ago(10) })],
      detail: (id) => (id === "fo1" ? summary("fo1", { kind: "folder", title: "Dự án" }) : null),
      tree: () => [{ id: "fo1", title: "Dự án", kind: "folder", position: 0, children: [] }],
    });
    renderView(url);
    await screen.findByText(title);
    expectOneFilterBar({ segment: url === "/?view=recent" });
  });

  it("draws no filter bar on Thùng rác", async () => {
    route({ list: () => [summary("r-trash", { archived_at: ago(60), purge_after: inDays(20) })] });
    renderView("/?view=archived");
    await screen.findByText("r-trash");
    expect(typeFilterSelect()).toBeNull();
    expect(editorSelect()).toBeNull();
    expect(updatedSelect()).toBeNull();
    expect(activityGroup()).toBeNull();
  });

  it("sends type=txt, the Người sửa id, the Cập nhật bound and the Gần đây segment to the server", async () => {
    route({ list: () => [summary("r1", { last_activity: { kind: "opened", at: ago(5) } })] });
    renderView("/?view=recent");
    await screen.findAllByText("r1");
    const recent = (path: string) => path.startsWith(`${LIST_BASE}/recent`);

    await pickTypeFilter("txt");
    await waitFor(() => expect(queryOf(lastCall(recent)).get("type")).toBe("txt"));

    fireEvent.click(within(activityGroup()!).getByRole("radio", { name: "Đã sửa" }));
    await waitFor(() => expect(queryOf(lastCall(recent)).get("activity")).toBe("edited"));
    expect(within(activityGroup()!).getByRole("radio", { name: "Đã sửa" })).toHaveAttribute("aria-checked", "true");

    await choose(editorSelect()!, "Bình");
    await waitFor(() => expect(queryOf(lastCall(recent)).get("updated_by")).toBe("u2"));

    await choose(updatedSelect()!, t("documents.home.filters.updated_7d"));
    await waitFor(() => expect(queryOf(lastCall(recent)).get("updated_from")).toBeTruthy());
    const query = queryOf(lastCall(recent));
    expect([query.get("type"), query.get("activity"), query.get("updated_by")]).toEqual(["txt", "edited", "u2"]);

    fireEvent.click(within(activityGroup()!).getByRole("radio", { name: "Tất cả" }));
    await waitFor(() => expect(queryOf(lastCall(recent)).has("activity")).toBe(false));
  });

  it.each([
    ["Được chia sẻ với tôi", "/?view=shared", (path: string) => path.startsWith(`${LIST_BASE}/shared-with-me`)],
    ["Tôi đã chia sẻ", "/?view=shared-by-me", (path: string) => queryOf(path).get("shared_by_me") === "true"],
    ["Lưu trữ", "/?view=shelved", (path: string) => queryOf(path).get("shelved") === "true"],
  ])("sends Người sửa = Tôi and the Cập nhật bound to the server on %s", async (_name, url, match) => {
    route({ list: () => [summary("row", { shelved_at: ago(60) })] });
    renderView(url);
    await screen.findByText("row");
    await choose(editorSelect()!, t("documents.home.filters.editor_me"));
    await waitFor(() => expect(queryOf(lastCall(match)).get("updated_by")).toBe("u1"));
    await choose(updatedSelect()!, t("documents.home.filters.updated_today"));
    await waitFor(() => expect(queryOf(lastCall(match)).get("updated_from")).toBeTruthy());
  });

  it("sends the type for an open folder, and Người sửa still filters it on the client", async () => {
    route({
      list: (path) => {
        const rows: Record<string, unknown>[] = [txtFile("notes", { parent_id: "fo1" }), summary("plan", { parent_id: "fo1", updated_by: "u2" })];
        const wanted = queryOf(path).getAll("type");
        return rows.filter((row) => wanted.length === 0 || wanted.includes(row.kind === "page" ? "page" : String(row.format)));
      },
      detail: (id) => (id === "fo1" ? summary("fo1", { kind: "folder", title: "Dự án" }) : null),
      tree: () => [{ id: "fo1", title: "Dự án", kind: "folder", position: 0, children: [] }],
    });
    renderView("/?folder=fo1");
    await screen.findByText("notes.txt");
    await pickTypeFilter("txt");
    await waitFor(() => expect(screen.queryByText("plan")).toBeNull());
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(queryOf(lastCall((path) => queryOf(path).get("parent_id") === "fo1")).getAll("type")).toEqual(["txt"]);
    await pickTypeFilter("all");
    await screen.findByText("plan");
    await choose(editorSelect()!, "Bình");
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
    expect(screen.getByText("plan")).toBeInTheDocument();
    // Người sửa is the client's here: no request carries it.
    for (const path of listCalls()) expect(queryOf(path).has("updated_by")).toBe(false);
  });

  it("filters Có gắn sao on the client by Người sửa and Cập nhật", async () => {
    route({ starred: () => [summary("mine", { favorited_at: ago(10) }), summary("old", { updated_by: "u2", updated_at: ago(60 * 24 * 40), favorited_at: ago(10) })] });
    renderView("/?view=starred");
    await screen.findByText("old");
    await choose(updatedSelect()!, t("documents.home.filters.updated_30d"));
    await waitFor(() => expect(screen.queryByText("old")).toBeNull());
    expect(screen.getByText("mine")).toBeInTheDocument();
  });

  it("resets the filters on a screen change", async () => {
    route({ list: () => [summary("row")] });
    renderView("/?view=recent");
    await screen.findByText("row");
    await choose(editorSelect()!, "Bình");
    fireEvent.click(within(activityGroup()!).getByRole("radio", { name: "Đã mở" }));
    fireEvent.click((await screen.findAllByRole("button", { name: new RegExp(t("documents.home.sidebar.shared")) }))[0]!);
    await waitFor(() => expect(listCalls(`${LIST_BASE}/shared-with-me`).length).toBeGreaterThan(0));
    expect(editorSelect()!.textContent).toContain(t("documents.home.filters.editor_any"));
    expect(queryOf(lastCall((path) => path.startsWith(`${LIST_BASE}/shared-with-me`))).has("updated_by")).toBe(false);
  });
});

describe("date groups (W11)", () => {
  const recentRows = () => [
    summary("today-doc", { last_activity: { kind: "edited", at: ago(5) } }),
    summary("old-doc", { last_activity: { kind: "opened", at: ago(60 * 24 * 40) } }),
  ];
  const groupButton = (label: string) => screen.findByRole("button", { name: new RegExp(`^${label}`) });

  it("groups Gần đây by last activity in its own order and goes flat under another sort", async () => {
    route({ list: () => recentRows() });
    renderView("/?view=recent");
    await screen.findAllByText("today-doc");
    const recent = (path: string) => path.startsWith(`${LIST_BASE}/recent`);
    expect(queryOf(lastCall(recent)).get("sort")).toBe("activity");
    expect(queryOf(lastCall(recent)).get("order")).toBe("desc");
    const today = await groupButton("Hôm nay");
    expect(today).toHaveAttribute("aria-expanded", "true");
    expect(today.textContent).toContain("1");
    expect(await groupButton("Trước đó")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.list.column.name")) }));
    await waitFor(() => expect(queryOf(lastCall(recent)).get("sort")).toBe("name"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Hôm nay/ })).toBeNull());
    expect(inTable().getByText("today-doc")).toBeInTheDocument();
  });

  it("draws no group header on Gần đây under Dung lượng, either direction, and again once Gần đây's own column is picked (F5)", async () => {
    route({ list: () => recentRows() });
    renderView("/?view=recent");
    await screen.findAllByText("today-doc");
    expect(await groupButton("Hôm nay")).toBeInTheDocument();
    const recent = (path: string) => path.startsWith(`${LIST_BASE}/recent`);
    const size = () => screen.getByRole("button", { name: new RegExp(t("documents.list.column.size")) });
    for (const order of ["desc", "asc"]) {
      fireEvent.click(size());
      await waitFor(() => expect(queryOf(lastCall(recent)).get("sort")).toBe("size"));
      await waitFor(() => expect(queryOf(lastCall(recent)).get("order")).toBe(order));
      await waitFor(() => expect(document.querySelectorAll("[data-library-group]")).toHaveLength(0));
      expect(screen.queryByRole("button", { name: /^(Hôm nay|Trước đó)/ })).toBeNull();
    }
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.list.screen_column.activity")) }));
    expect(await groupButton("Hôm nay")).toBeInTheDocument();
  });

  it("groups Được chia sẻ với tôi by the share date, asking for sort=shared", async () => {
    route({ list: () => [summary("new-share", { shared: { by: "u2", by_kind: "human", by_name: "Bình", at: ago(5) } }), summary("old-share", { shared: { by: "u2", by_kind: "human", by_name: "Bình", at: ago(60 * 24 * 40) } })] });
    renderView("/?view=shared");
    await screen.findByText("new-share");
    expect(queryOf(lastCall((path) => path.startsWith(`${LIST_BASE}/shared-with-me`))).get("sort")).toBe("shared");
    expect(await groupButton("Tuần này")).toBeInTheDocument();
    expect(await groupButton("Trước đó")).toBeInTheDocument();
  });

  it("groups Thùng rác by days left, Sắp xóa vĩnh viễn first", async () => {
    route({ list: () => [summary("soon", { archived_at: ago(60), purge_after: inDays(3) }), summary("later", { archived_at: ago(60), purge_after: inDays(20) })] });
    renderView("/?view=archived");
    await screen.findByText("soon");
    const soon = await groupButton("Sắp xóa vĩnh viễn");
    const later = await groupButton("Còn trên 7 ngày");
    expect(soon.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("remembers a collapsed group per user and screen across a remount", async () => {
    route({ list: () => recentRows() });
    const first = renderView("/?view=recent");
    await screen.findAllByText("today-doc");
    fireEvent.click(await groupButton("Hôm nay"));
    await waitFor(() => expect(inTable().queryByText("today-doc")).toBeNull());
    expect((await groupButton("Hôm nay")).getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "{}")).toEqual({ recent: ["today"] });
    first.unmount();
    cleanup();

    renderView("/?view=recent");
    await screen.findAllByText("old-doc");
    expect((await groupButton("Hôm nay")).getAttribute("aria-expanded")).toBe("false");
    expect(inTable().queryByText("today-doc")).toBeNull();
  });

  it("renders every group open when the storage throws or holds corrupt JSON", async () => {
    route({ list: () => recentRows() });
    localStorage.setItem(GROUPS_KEY, "{broken");
    const corrupt = renderView("/?view=recent");
    await screen.findAllByText("today-doc");
    expect((await groupButton("Hôm nay")).getAttribute("aria-expanded")).toBe("true");
    corrupt.unmount();
    cleanup();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderView("/?view=recent");
    await screen.findAllByText("today-doc");
    const today = await groupButton("Hôm nay");
    expect(today.getAttribute("aria-expanded")).toBe("true");
    // A toggle still works for the session even when it cannot be saved.
    fireEvent.click(today);
    await waitFor(() => expect(inTable().queryByText("today-doc")).toBeNull());
  });
});
