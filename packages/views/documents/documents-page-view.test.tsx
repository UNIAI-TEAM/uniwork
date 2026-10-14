import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import type { OfficeLaunchSessionFactory } from "../office";
import { DocumentsPageView } from "./documents-page-view";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

/** The screen is gated by `documents`; the flag has to be on to see anything. */
function withFlag(ui: React.ReactElement, on: boolean) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
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

function treeNode(over: Record<string, unknown> = {}) {
  return { id: "t1", title: "Nhóm", kind: "page", position: 0, children: [], ...over };
}

function renderView(
  onOpen: (id: string) => void,
  opts:
    | boolean
    | {
        desktopOpen?: React.ComponentProps<typeof DocumentsPageView>["desktopOpen"];
        officeHome?: React.ComponentProps<typeof DocumentsPageView>["officeHome"];
      } = true,
) {
  const on = typeof opts === "boolean" ? opts : true;
  const desktopOpen = typeof opts === "boolean" ? undefined : opts.desktopOpen;
  const officeHome = typeof opts === "boolean" ? undefined : opts.officeHome;
  return render(
    withFlag(<DocumentsPageView wsId={WS} onOpen={onOpen} desktopOpen={desktopOpen} officeHome={officeHome} />, on),
  );
}

function queryOf(path: string) {
  return new URLSearchParams(path.split("?")[1] ?? "");
}

function postCall(method: string) {
  return requestMock.mock.calls.find(
    ([, opts]) => (opts as { method?: string } | undefined)?.method === method,
  );
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

describe("DocumentsPageView", () => {
  const otherCalls = () => requestMock.mock.calls.filter(([path]) => !String(path).startsWith("/api/v1/config"));

  it("stays behind its flag once the config answered that it is off", async () => {
    requestMock.mockResolvedValue({ flags: { documents: false }, rum_sample_rate: 0 });
    const onOpen = vi.fn();
    renderView(onOpen, false);
    expect(await screen.findByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.unknown_title"))).toBeNull();
    expect(otherCalls()).toHaveLength(0);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("says it could not check, not that documents are off, when the config call fails", async () => {
    let configCalls = 0;
    requestMock.mockImplementation((path: string) => {
      if (!path.startsWith("/api/v1/config")) return Promise.resolve({});
      configCalls += 1;
      return configCalls === 1
        ? Promise.reject(new ApiError("boom", "internal", 500))
        : Promise.resolve({ flags: { documents: false }, rum_sample_rate: 0 });
    });
    renderView(vi.fn(), false);

    expect(await screen.findByText(t("documents.page.unknown_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.off_title"))).toBeNull();
    expect(otherCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: t("documents.page.unknown_retry") }));
    // A settled answer is the only thing that may claim the feature is off.
    expect(await screen.findByText(t("documents.page.off_title"))).toBeInTheDocument();
  });

  it("shows a neutral checking state while the config has not answered", () => {
    requestMock.mockImplementation(() => new Promise(() => {}));
    renderView(vi.fn(), false);
    expect(screen.getByText(t("documents.page.checking_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.page.off_title"))).toBeNull();
  });


  it("translates its home copy instead of falling back to keys", () => {
    // A missing key renders as the key itself and the screen would read
    // "documents.home.scope.home" in production.
    for (const key of [
      "documents.home.scope.home",
      "documents.home.empty.title",
      "documents.home.greeting.morning_named",
      "documents.home.default_names.docx",
      "documents.home.create.upload.card",
      "documents.home.folders.empty",
      "office.desktop.row_action",
    ]) {
      expect(t(key)).not.toBe(key);
    }
  });

  it("lists the rows the server returned and counts them on the tab", async () => {
    route({ list: () => [summary(), summary({ id: "d2", title: "Biên bản họp" })] });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.getByText("Biên bản họp")).toBeInTheDocument();
    // The tab shows the loaded row count from the server, not a made-up one.
    const tab = screen.getByRole("tab", { name: new RegExp(t("documents.home.scope.home")) });
    expect(within(tab).getByText("2")).toBeInTheDocument();
  });

  it("shows skeleton rows while the first page loads, never fake rows", () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: [] }) : new Promise(() => {}),
    );
    renderView(vi.fn());

    expect(screen.getByLabelText(t("documents.library.loading"))).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
  });

  it("shows the empty state with the create cards when the library is truly empty", async () => {
    route({ list: () => [] });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.home.empty.title"))).toBeInTheDocument();
    const cards = screen.getByRole("list", { name: t("documents.home.create.label") });
    for (const type of ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"]) {
      expect(within(cards).getByRole("button", { name: new RegExp(escape(t(`documents.home.create.${type}.card`))) })).toBeInTheDocument();
    }
    expect(within(cards).getByRole("button", { name: new RegExp(t("documents.home.create.upload.card")) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeInTheDocument();
  });

  it("offers a retry when the list cannot be read", async () => {
    let listCalls = 0;
    route({
      list: () => {
        listCalls += 1;
        if (listCalls === 1) throw new ApiError("boom", "internal", 500);
        return [summary()];
      },
    });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("loads another cursor page only when load more is clicked", async () => {
    const urls: string[] = [];
    route({
      list: (path) => {
        urls.push(path);
        return queryOf(path).get("cursor") === "c2" ? [summary({ id: "d2", title: "Trang hai" })] : [summary()];
      },
      cursor: (path) => (queryOf(path).get("cursor") === "c2" ? null : "c2"),
    });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Trang hai")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));

    expect(await screen.findByText("Trang hai")).toBeInTheDocument();
    expect(urls.some((url) => queryOf(url).get("cursor") === "c2")).toBe(true);
  });

  it("filters by type chip: pages ask the server, file types keep only their extension", async () => {
    const urls: string[] = [];
    route({
      list: (path) => {
        urls.push(path);
        if (queryOf(path).get("kind") === "page") return [summary()];
        return [summary(), file("f1", "Báo giá.docx"), file("f2", "Số liệu.xlsx")];
      },
    });
    renderView(vi.fn());
    expect(await screen.findByText("Số liệu.xlsx")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.docx") }));
    expect(screen.getByText("Báo giá.docx")).toBeInTheDocument();
    expect(screen.queryByText("Số liệu.xlsx")).toBeNull();
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.page") }));
    await waitFor(() => expect(urls.some((url) => queryOf(url).get("kind") === "page")).toBe(true));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
  });

  it("shows the filtered empty state when a chip matches nothing, and clears it", async () => {
    route({ list: () => [summary()] });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.pdf") }));
    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.clear_filters") }));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("groups by folder by default and by file type on request", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [summary(), file("f1", "Báo giá.docx", { parent_id: "fo1" })],
    });
    renderView(vi.fn());
    await screen.findByText("Báo giá.docx");

    const groupHeaders = () => Array.from(document.querySelectorAll("[data-library-group]")).map((cell) => cell.textContent);
    await waitFor(() => expect(groupHeaders()).toEqual([`${t("documents.home.groups.unfiled")}1`, "Dự án CCB1"]));

    fireEvent.click(screen.getByRole("combobox", { name: t("documents.home.group_by.label") }));
    const option = within(await screen.findByRole("listbox")).getByText(t("documents.home.group_by.type"));
    // Base UI only commits a click that started on the item with a pointer.
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    await waitFor(() =>
      expect(groupHeaders()).toEqual([`${t("documents.home.groups.type.page")}1`, `${t("documents.home.groups.type.docx")}1`]),
    );
  });

  it("explains the archive permission instead of rendering an empty archive", async () => {
    route({
      list: (path) => {
        if (queryOf(path).get("archived") === "1") throw new ApiError("forbidden", "forbidden", 403);
        return [summary()];
      },
    });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.home.scope.archived")) }));

    expect(await screen.findByText(t("documents.library.permission_title"))).toBeInTheDocument();
  });

  it("loads the recent and shared tabs from their own endpoints", async () => {
    route({
      list: (path) => {
        if (path.startsWith(`${LIST_BASE}/recent`)) return [summary({ id: "r1", title: "Mở gần đây" })];
        if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return [summary({ id: "s1", title: "Được chia sẻ" })];
        return [];
      },
    });
    renderView(vi.fn());
    await screen.findByText(t("documents.home.empty.title"));

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.home.scope.recent")) }));
    expect(await screen.findByText("Mở gần đây")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.home.scope.shared")) }));
    expect(await screen.findByText("Được chia sẻ")).toBeInTheDocument();
  });

  it("navigates into a folder from its row, lists its children and renames it on the breadcrumb", async () => {
    const urls: string[] = [];
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: (path) => {
        urls.push(path);
        if (queryOf(path).get("parent_id") === "fo1") return [file("f1", "Bên trong.docx", { parent_id: "fo1" })];
        return [summary({ id: "fo1", kind: "folder", title: "Dự án CCB" })];
      },
      detail: (id) => (id === "fo1" ? folderDetail({ my_level: "manage" }) : null),
      patch: () => ({ document: folderDetail({ title: "CCB 2027", revision: "4" }) }),
    });
    const onOpen = vi.fn();
    renderView(onOpen);

    const table = await screen.findByRole("table");
    fireEvent.click(await within(table).findByText("Dự án CCB"));

    expect(await screen.findByText("Bên trong.docx")).toBeInTheDocument();
    expect(urls.some((url) => queryOf(url).get("parent_id") === "fo1")).toBe(true);
    expect(onOpen).not.toHaveBeenCalled();
    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).getByText("Dự án CCB")).toHaveAttribute("aria-current", "page");
    // The folder is drawn as current in the sidebar tree too.
    expect(screen.getByRole("treeitem", { name: /Dự án CCB/ })).toHaveAttribute("aria-current", "true");

    fireEvent.click(within(crumbs).getByRole("button", { name: t("documents.home.folders.rename") }));
    const input = within(crumbs).getByRole("textbox", { name: t("documents.home.folders.rename_label") });
    fireEvent.change(input, { target: { value: "CCB 2027" } });
    fireEvent.submit(input);
    await waitFor(() => {
      const patch = requestMock.mock.calls.find(([, opts]) => (opts as { method?: string } | undefined)?.method === "PATCH");
      expect(patch?.[0]).toBe("/api/v1/documents/fo1");
      expect((patch?.[1] as { body?: unknown }).body).toEqual({ revision: "3", title: "CCB 2027" });
    });
  });

  it("opens a folder from the sidebar tree, which lists folders only", async () => {
    route({
      tree: () => [
        treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" }),
        treeNode({ id: "p1", title: "Một trang", kind: "page" }),
      ],
      list: () => [],
      detail: () => folderDetail(),
    });
    const onOpen = vi.fn();
    renderView(onOpen);

    const folderItem = await screen.findByRole("treeitem", { name: /Dự án CCB/ });
    expect(screen.queryByRole("treeitem", { name: /Một trang/ })).toBeNull();
    fireEvent.click(folderItem);
    expect(await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("creates a page from its card and opens it", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], post: () => ({ document: summary() }) });
    renderView(onOpen);

    fireEvent.click(await cardButton("page"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d1"));
    const call = postCall("POST");
    expect(call?.[0]).toBe(LIST_BASE);
    expect((call?.[1] as { body?: { title?: string } }).body?.title).toBe(t("documents.page.new_page"));
  });

  it("creates a blank file with its default name from a card, then opens the editor", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], post: () => ({ document: file("n1", t("documents.home.default_names.docx")) }) });
    renderView(onOpen);

    fireEvent.click(await cardButton("docx"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n1"));
    const call = postCall("POST");
    expect(call?.[0]).toBe(`${LIST_BASE}/files/blank`);
    expect((call?.[1] as { body?: unknown }).body).toEqual({
      format: "docx",
      title: t("documents.home.default_names.docx"),
    });
  });

  it("creates from the header menu in the open folder", async () => {
    const onOpen = vi.fn();
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [],
      detail: () => folderDetail({ my_level: "edit" }),
      post: () => ({ document: file("n2", t("documents.home.default_names.xlsx")) }),
    });
    renderView(onOpen);
    fireEvent.click(await screen.findByRole("treeitem", { name: /Dự án CCB/ }));
    await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(t("documents.home.create.xlsx.menu")) }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("n2"));
    expect((postCall("POST")?.[1] as { body?: unknown }).body).toEqual({
      format: "xlsx",
      title: t("documents.home.default_names.xlsx"),
      parent_id: "fo1",
    });
  });

  it("disables a card the server cannot create yet instead of failing the page", async () => {
    route({
      list: () => [],
      post: () => {
        throw new ApiError("not found", "not_found", 404);
      },
    });
    renderView(vi.fn());

    const pptx = await cardButton("pptx");
    fireEvent.click(pptx);

    await waitFor(() => expect(pptx).toHaveAttribute("aria-disabled", "true"));
    expect(pptx).toHaveTextContent(t("documents.home.create.unavailable_hint"));
  });

  it("hides every create control in a folder the user may only view", async () => {
    route({
      tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
      list: () => [],
      detail: () => folderDetail({ my_level: "view" }),
    });
    renderView(vi.fn());
    fireEvent.click(await screen.findByRole("treeitem", { name: /Dự án CCB/ }));

    expect(await screen.findByText(t("documents.home.empty.view_only"))).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: t("documents.home.create.label") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("documents.home.create.menu")) })).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.home.folders.new") })).toBeNull();
    const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).queryByRole("button", { name: t("documents.home.folders.rename") })).toBeNull();
  });

  it("creates a folder with its default name and opens it", async () => {
    route({
      list: () => [],
      post: () => ({ document: folderDetail({ id: "fo9", title: t("documents.home.folders.default_name") }) }),
      detail: () => folderDetail({ id: "fo9", title: t("documents.home.folders.default_name") }),
    });
    renderView(vi.fn());

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.folders.new") }));
    const dialog = await screen.findByRole("dialog", { name: t("documents.home.folders.create_title_root") });
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));

    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") });
    expect(within(crumbs).getByText(t("documents.home.folders.default_name"))).toBeInTheDocument();
    expect((postCall("POST")?.[1] as { body?: unknown }).body).toEqual({
      kind: "folder",
      title: t("documents.home.folders.default_name"),
    });
  });

  it("lists files from other modules as links: download and save, no app action", async () => {
    route({
      list: () => [summary()],
      sources: () => [source()],
      post: () => ({ document: file("c1", "Đề xuất ngân sách.pdf") }),
    });
    const createSession = vi.fn<OfficeLaunchSessionFactory>();
    renderView(vi.fn(), { desktopOpen: desktopOpenWith(createSession) });

    const row = await rowOf("Đề xuất ngân sách.pdf");
    expect(within(row).getAllByText(t("documents.home.origin.chat")).length).toBeGreaterThan(0);
    expect(within(row).getByText("Dũng")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: t("office.desktop.row_action") })).toBeNull();
    expect(within(row).getByRole("button", { name: t("documents.home.row.download") })).toBeInTheDocument();
    // The sidebar names the modules once the sources API answered.
    expect(screen.getByRole("button", { name: t("documents.home.origin.chat") })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.save_to_folder") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));

    await waitFor(() => {
      const call = postCall("POST");
      expect(call?.[0]).toBe(`${LIST_BASE}/sources/chat%3Am1/save`);
      expect((call?.[1] as { body?: unknown }).body).toEqual({ parent_id: null });
      // A retried POST after a timeout must replay, not save the file twice.
      expect((call?.[1] as { headers?: Record<string, string> }).headers?.["Idempotency-Key"]).toBeTruthy();
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("hides the other-modules section when the sources API is not deployed", async () => {
    route({ list: () => [summary()], sources: () => { throw new ApiError("not found", "not_found", 404); } });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");
    await waitFor(() => expect(sourceCalls()).toBeGreaterThan(0));
    expect(screen.queryByText(t("documents.home.sidebar.elsewhere"))).toBeNull();
    // Not retried: a missing route is an answer, not a failure.
    expect(sourceCalls()).toBe(1);
  });

  it("opens a file row in the app, read-only for a viewer, and never on pages", async () => {
    route({
      list: () => [summary(), file("f1", "Báo giá.docx", { my_level: "view", current_version: 2 })],
    });
    const createSession = vi.fn<OfficeLaunchSessionFactory>().mockResolvedValue(null);
    renderView(vi.fn(), { desktopOpen: desktopOpenWith(createSession) });

    const fileRow = await rowOf("Báo giá.docx");
    const pageRow = await rowOf("Kế hoạch Q4");
    expect(within(pageRow).queryByRole("button", { name: t("office.desktop.row_action") })).toBeNull();

    fireEvent.click(within(fileRow).getByRole("button", { name: t("office.desktop.row_action") }));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession.mock.calls[0]?.[0]).toBe("f1");
    expect(createSession.mock.calls[0]?.[1]).toMatchObject({ operation: "view", deployment_id: "dep-1" });
  });

  it("shows a file's size and whether it was uploaded or created here", async () => {
    route({
      list: () => [
        summary({ id: "u1", kind: "file", title: "Hợp đồng.pdf", size_bytes: 2048, origin: "upload" }),
        summary({ id: "c1", kind: "file", title: "Báo cáo.docx", size_bytes: 0, origin: "created" }),
      ],
    });
    renderView(vi.fn());
    const uploaded = await rowOf("Hợp đồng.pdf");
    expect(within(uploaded).getByText(t("documents.home.origin.upload"))).toBeInTheDocument();
    expect(within(uploaded).getAllByText(/2 KB/).length).toBeGreaterThan(0);
    const created = await rowOf("Báo cáo.docx");
    expect(within(created).getByText(t("documents.home.origin.created"))).toBeInTheDocument();
  });

  it("moves a row into a folder picked in the dialog, on the revision it reads first", async () => {
    route({
      list: () => [summary({ id: "d1" }), summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder" }), treeNode({ id: "d1", title: "Kế hoạch Q4" })],
      detail: (id) => summary({ id, revision: "7" }),
      post: (path) => (path.endsWith("/move") ? { document: summary({ id: "d1", parent_id: "f1", revision: "8" }) } : {}),
    });
    renderView(vi.fn());
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.move") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => {
      const call = postCall("POST");
      expect(call?.[0]).toBe("/api/v1/documents/d1/move");
      expect((call?.[1] as { body?: unknown }).body).toEqual({ parent_id: "f1", revision: "7" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a refused move in the dialog with the localized reason, and never offers a folder inside itself", async () => {
    route({
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder", children: [treeNode({ id: "f2", title: "Con", kind: "folder", parent_id: "f1" })] })],
      detail: (id) => summary({ id, kind: "folder", revision: "2" }),
      post: () => {
        throw new ApiError("server text", "document_parent_kind", 422);
      },
    });
    renderView(vi.fn());
    // The folder is in the sidebar tree too; the row menu names it.
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.move") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Hợp đồng" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Con" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.document_parent_kind"))).toBeInTheDocument();
  });

  it("says archiving a folder takes everything in it", async () => {
    route({ list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })] });
    renderView(vi.fn());
    const row = await rowOf("Hợp đồng");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.archive") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.archive.archive_folder_title"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("documents.archive.archive_folder_description"))).toBeInTheDocument();
  });

  it("offers no move or archive on the archive and shared tabs", async () => {
    route({ list: () => [summary()] });
    renderView(vi.fn());
    fireEvent.click(await screen.findByRole("tab", { name: t("documents.home.scope.archived") }));
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") });
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.move") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.archive") })).toBeNull();
  });

  it("gates Move and Archive by the level of each row, not by the open folder", async () => {
    route({
      list: () => [
        summary({ id: "m1", title: "Quản lý", my_level: "manage" }),
        summary({ id: "e1", title: "Chỉnh sửa", my_level: "edit" }),
        summary({ id: "v1", title: "Chỉ xem", my_level: "view" }),
        summary({ id: "n1", title: "Chưa rõ", my_level: undefined }),
      ],
    });
    renderView(vi.fn());
    const menuItems = async (title: string) => {
      const row = await rowOf(title);
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") });
      const has = (key: string) => screen.queryByRole("menuitem", { name: t(key) }) !== null;
      const out = { move: has("documents.home.row.move"), archive: has("documents.home.row.archive") };
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: t("documents.home.row.open_web") })).toBeNull());
      return out;
    };
    expect(await menuItems("Quản lý")).toEqual({ move: true, archive: true });
    expect(await menuItems("Chỉnh sửa")).toEqual({ move: true, archive: false });
    expect(await menuItems("Chỉ xem")).toEqual({ move: false, archive: false });
    // A row the server sent no level for reads as view: nothing it would refuse.
    expect(await menuItems("Chưa rõ")).toEqual({ move: false, archive: false });
  });

  it("opens an editable row in the app with an edit session and a view-only row read-only", async () => {
    route({
      list: () => [
        file("f1", "Sửa.docx", { my_level: "edit", current_version: 2 }),
        file("f2", "Xem.docx", { my_level: "view", current_version: 2 }),
      ],
    });
    const createSession = vi.fn<OfficeLaunchSessionFactory>().mockResolvedValue(null);
    renderView(vi.fn(), { desktopOpen: desktopOpenWith(createSession) });
    for (const [title, id, operation] of [["Sửa.docx", "f1", "edit"], ["Xem.docx", "f2", "view"]] as const) {
      createSession.mockClear();
      fireEvent.click(within(await rowOf(title)).getByRole("button", { name: t("office.desktop.row_action") }));
      await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
      expect(createSession.mock.calls[0]?.[0]).toBe(id);
      expect(createSession.mock.calls[0]?.[1]).toMatchObject({ operation });
    }
  });

  it("puts Open UniWork Office in the header, launching the app with no document", async () => {
    route({ list: () => [] });
    const launch = vi.fn(async () => "launched" as const);
    renderView(vi.fn(), {
      officeHome: {
        channel: "stable",
        launch,
        loadInstallers: vi.fn(async () => ({ installers: [] })),
        loadPlatformHint: vi.fn(async () => ({ platform: "win32-x64" as const, confidence: "certain" as const })),
        downloadInstaller: vi.fn(async () => "UniWork-Office.exe"),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.open_office") }));
    await waitFor(() => expect(launch).toHaveBeenCalledWith("uniwork-office://home"));
    expect(postCall("POST")).toBeUndefined();
  });

  it("says a chat file opens Chat, and offers no save for a file the server will not copy", async () => {
    route({ list: () => [], sources: () => [source({ can_save: false })] });
    renderView(vi.fn());
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_chat") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.go_to_source") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.save_to_folder") })).toBeNull();
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.download") })).toBeInTheDocument();
  });

  it("explains a refused save in the dialog", async () => {
    route({
      list: () => [],
      sources: () => [source()],
      post: () => {
        throw new ApiError("server text", "source_not_saveable", 422);
      },
    });
    renderView(vi.fn());
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.save_to_folder") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.save_source.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.source_not_saveable"))).toBeInTheDocument();
  });

  it("does not offer a move target past the depth limit", async () => {
    const chain = (level: number): ReturnType<typeof treeNode> =>
      treeNode({ id: `l${level}`, title: `Cấp ${level}`, kind: "folder", children: level < 5 ? [chain(level + 1)] : [] });
    route({
      list: () => [summary({ id: "d1" })],
      tree: () => [chain(1), treeNode({ id: "d1", title: "Kế hoạch Q4", children: [treeNode({ id: "d2", title: "Con" })] })],
    });
    renderView(vi.fn());
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.move") }));
    const dialog = await screen.findByRole("dialog");
    // A page with one child takes two levels: level 3 is the deepest target.
    expect(within(dialog).getByRole("button", { name: "Cấp 3" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cấp 4" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Cấp 5" })).toBeNull();
  });

  it("explains a folder too large to archive at once", async () => {
    route({
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      post: () => {
        throw new ApiError("server text", "folder_too_large", 422);
      },
    });
    renderView(vi.fn());
    const row = await rowOf("Hợp đồng");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.home.row.archive") }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: t("documents.archive.archive_confirm") });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(t("documents.errors.folder_too_large"))).toBeInTheDocument();
  });

  it("uploads a file from the card and opens the new document", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], upload: () => ({ document: file("d2", "note.txt") }) });
    renderView(onOpen);

    fireEvent.click(await cardButton("upload"));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] } });
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("note.txt");

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d2"));
  });

  it("keeps a failed upload in the dialog with the reason", async () => {
    route({
      list: () => [],
      upload: () => {
        throw new Error("boom");
      },
    });
    renderView(vi.fn());

    fireEvent.click(await cardButton("upload"));
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, { target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] } });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    // The picked file is still there, so the retry does not re-pick it.
    expect(screen.getByTestId("document-upload-selected")).toBeInTheDocument();
  });

  it("uploads files dropped on the library into the open view", async () => {
    route({ list: () => [], upload: () => ({ document: file("d3", "drop.txt") }) });
    renderView(vi.fn());
    const zone = await screen.findByRole("region", { name: t("documents.page.title") });
    const dropped = new File(["x"], "drop.txt", { type: "text/plain" });

    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [dropped] } });

    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => path === `${LIST_BASE}/files`)).toBe(true));
  });
});

/* ---- helpers --------------------------------------------------------------- */

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function file(id: string, title: string, over: Record<string, unknown> = {}) {
  return summary({
    id,
    kind: "file",
    title,
    organization_id: "org1",
    current_version: 1,
    my_level: "edit",
    file: {
      file_id: `file-${id}`,
      version_id: "v1",
      version: 1,
      filename: title,
      mime_type: "application/octet-stream",
      size_bytes: 5,
      checksum_sha256: "a".repeat(64),
    },
    ...over,
  });
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
  sources?: () => unknown[];
  detail?: (id: string) => unknown;
  post?: (path: string) => unknown;
  patch?: () => unknown;
  upload?: () => unknown;
}

/** One transport stub for the whole screen; anything unrouted answers `{}`. */
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
    if (path === `${LIST_BASE}/files`) return run(() => routes.upload?.() ?? {});
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return run(() => ({ items: routes.sources?.() ?? [], next_cursor: null }));
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

function sourceCalls() {
  return requestMock.mock.calls.filter(([path]) => String(path).startsWith(`${LIST_BASE}/sources`)).length;
}

async function cardButton(type: string) {
  const cards = await screen.findByRole("list", { name: t("documents.home.create.label") });
  return within(cards).getByRole("button", { name: new RegExp(`^${escape(t(`documents.home.create.${type}.card`))}`) });
}

async function rowOf(title: string) {
  const name = await screen.findByText(title);
  const row = name.closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

function desktopOpenWith(createSession: OfficeLaunchSessionFactory) {
  return () => ({
    deploymentId: "dep-1",
    savedVersion: 1,
    createSession,
    launch: vi.fn().mockResolvedValue("launched"),
  });
}
