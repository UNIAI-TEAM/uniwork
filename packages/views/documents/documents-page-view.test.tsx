import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { TREE_MAX_LEVEL } from "@uniwork/core/documents/folder-limits";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { defaultStorage } from "@uniwork/core/platform";
import { fakeNav, requestMock, wrap, wrapWithNav } from "../test/api-mock";
import type { OfficeLaunchSessionFactory } from "../office";
import { WorkspaceProvider } from "../layout/workspace-context";
import { DocumentsPageView } from "./documents-page-view";
import { useDocumentsLibrary } from "./use-documents-library";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const FOLDER_SORT_KEY = "uniwork_documents_folder_sort";
const userFolderSortKey = (userId: string) => `${FOLDER_SORT_KEY}:${userId}`;

const sessionUser = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

/** The screen is gated by `documents`; the flag has to be on to see anything. */
function withFlag(ui: React.ReactElement, on: boolean, initialUrl?: string) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={sessionUser}>
      <FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>
    </WorkspaceProvider>,
    fakeNav(initialUrl),
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
        initialUrl?: string;
      } = true,
) {
  const on = typeof opts === "boolean" ? opts : true;
  const desktopOpen = typeof opts === "boolean" ? undefined : opts.desktopOpen;
  const officeHome = typeof opts === "boolean" ? undefined : opts.officeHome;
  const initialUrl = typeof opts === "boolean" ? undefined : opts.initialUrl;
  return render(
    withFlag(<DocumentsPageView wsId={WS} onOpen={onOpen} desktopOpen={desktopOpen} officeHome={officeHome} />, on, initialUrl),
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
  defaultStorage.removeItem(FOLDER_SORT_KEY);
  defaultStorage.removeItem(userFolderSortKey("u1"));
  defaultStorage.removeItem(userFolderSortKey("u2"));
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
      "documents.home.sidebar.home",
      "documents.home.empty.title",
      "documents.home.quick_create.label",
      "documents.home.default_names.docx",
      "documents.home.create.upload.button",
      "documents.home.folders.empty",
      "office.desktop.row_action",
    ]) {
      expect(t(key)).not.toBe(key);
    }
  });

  it("lists the rows the server returned and counts them on the documents section, with no module header", async () => {
    route({ list: () => [summary(), summary({ id: "d2", title: "Biên bản họp" })] });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.getByText("Biên bản họp")).toBeInTheDocument();
    // The section heading shows the loaded row count from the server, not a made-up one.
    expect(
      screen.getByRole("heading", { level: 2, name: new RegExp(`^${t("documents.home.sections.documents")}`) }),
    ).toHaveTextContent(/2$/);
    // The home root has no module header and no scope tabs.
    expect(screen.queryByRole("heading", { level: 1, name: t("documents.page.title") })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("shows skeleton rows while the first page loads, never fake rows", () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: [] }) : new Promise(() => {}),
    );
    renderView(vi.fn());

    expect(screen.getByLabelText(t("documents.library.loading"))).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
  });

  it("shows the empty state with the Tạo nhanh pills when the library is truly empty", async () => {
    route({ list: () => [] });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.home.empty.title"))).toBeInTheDocument();
    const strip = screen.getByRole("region", { name: t("documents.home.quick_create.label") });
    for (const type of ["page", "docx", "xlsx", "pptx", "md", "html", "pdf"]) {
      expect(within(strip).getByRole("button", { name: new RegExp(escape(t(`documents.home.create.${type}.chip`))) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: t("documents.home.create.upload.button") })).toBeInTheDocument();
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

  it("filters by the Loại select: pages ask the server, file types keep only their extension", async () => {
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

    await choose(typeSelect(), t("documents.home.chips.docx"));
    expect(await screen.findByText("Báo giá.docx")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Số liệu.xlsx")).toBeNull());
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();

    await choose(typeSelect(), t("documents.home.chips.page"));
    await waitFor(() => expect(urls.some((url) => queryOf(url).get("kind") === "page")).toBe(true));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Báo giá.docx")).toBeNull();
  });

  it("shows the filtered empty state when a chip matches nothing, and clears it", async () => {
    route({ list: () => [summary()] });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    await choose(typeSelect(), t("documents.home.chips.pdf"));
    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.clear_filters") }));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  describe("access filter (UNI-1642), on the Recent view where the chips and pills live", () => {
    const accessRows = () => [
      summary({ my_level: "manage" }),
      file("f1", "Báo giá.docx", { my_level: "edit" }),
      file("f2", "Số liệu.xlsx", { my_level: "view" }),
      file("f3", "Hợp đồng.docx", { my_level: "manage", visibility: "restricted" }),
    ];
    const accessGroup = () => screen.getByRole("group", { name: t("documents.home.access_filter_label") });
    const typeGroup = () => screen.getByRole("group", { name: t("documents.home.chips_label") });
    const pressed = (group: HTMLElement, name: string) => within(group).getByRole("button", { name }).getAttribute("aria-pressed");

    it("filters through the real hook, and clear-filters puts every row and both All chips back", async () => {
      route({ list: accessRows });
      renderView(vi.fn());
      await openView("recent");
      await screen.findByText("Số liệu.xlsx");

      fireEvent.click(within(accessGroup()).getByRole("button", { name: t("documents.home.access_filters.edit") }));
      expect(pressed(accessGroup(), t("documents.home.access_filters.edit"))).toBe("true");
      expect(screen.getByText("Kế hoạch Q4")).toBeInTheDocument();
      expect(screen.getByText("Báo giá.docx")).toBeInTheDocument();
      expect(screen.getByText("Hợp đồng.docx")).toBeInTheDocument();
      expect(screen.queryByText("Số liệu.xlsx")).toBeNull();

      fireEvent.click(within(accessGroup()).getByRole("button", { name: t("documents.home.access_filters.restricted") }));
      expect(screen.getByText("Hợp đồng.docx")).toBeInTheDocument();
      expect(screen.queryByText("Báo giá.docx")).toBeNull();

      // Nothing is both restricted and a spreadsheet: the empty state offers the clear action.
      fireEvent.click(within(typeGroup()).getByRole("button", { name: t("documents.home.chips.xlsx") }));
      expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t("documents.library.clear_filters") }));

      expect(await screen.findByText("Số liệu.xlsx")).toBeInTheDocument();
      expect(screen.getByText("Báo giá.docx")).toBeInTheDocument();
      expect(pressed(accessGroup(), t("documents.home.access_filters.all"))).toBe("true");
      expect(pressed(typeGroup(), t("documents.home.chips.all"))).toBe("true");
    });

    it("ANDs a type chip with the access filter, and the empty line names the filters when both are on", async () => {
      route({ list: accessRows });
      renderView(vi.fn());
      await openView("recent");
      await screen.findByText("Số liệu.xlsx");

      fireEvent.click(within(typeGroup()).getByRole("button", { name: t("documents.home.chips.docx") }));
      fireEvent.click(within(accessGroup()).getByRole("button", { name: t("documents.home.access_filters.manage") }));
      expect(screen.getByText("Hợp đồng.docx")).toBeInTheDocument();
      expect(screen.queryByText("Báo giá.docx")).toBeNull();
      expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
      expect(screen.queryByText("Số liệu.xlsx")).toBeNull();

      fireEvent.click(within(typeGroup()).getByRole("button", { name: t("documents.home.chips.xlsx") }));
      expect(await screen.findByText(t("documents.home.no_matches_filters_description"))).toBeInTheDocument();
      expect(screen.queryByText(t("documents.home.no_matches_access_description"))).toBeNull();
    });

    it("keeps the access-only empty line when only the access filter is on", async () => {
      route({ list: () => [summary({ my_level: "view" })] });
      renderView(vi.fn());
      await openView("recent");
      await screen.findByText("Kế hoạch Q4");

      fireEvent.click(within(accessGroup()).getByRole("button", { name: t("documents.home.access_filters.manage") }));
      expect(await screen.findByText(t("documents.home.no_matches_access_description"))).toBeInTheDocument();
    });
  });

  it("groups by folder by default and by file type on request, on the Recent view (home has no grouping)", async () => {
    route({
      tree: () => [
        treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" }),
        treeNode({ id: "fo-empty", title: "Thư mục trống", kind: "folder" }),
      ],
      list: () => [
        summary(),
        summary({ id: "fo1", kind: "folder", title: "Dự án CCB" }),
        summary({ id: "fo-empty", kind: "folder", title: "Thư mục trống" }),
        file("f1", "Báo giá.docx", { parent_id: "fo1" }),
      ],
    });
    renderView(vi.fn());
    await screen.findByText("Báo giá.docx");
    const groupHeaders = () => Array.from(document.querySelectorAll("[data-library-group]")).map((cell) => cell.textContent);
    // The home table is flat: no group headings.
    expect(groupHeaders()).toEqual([]);
    await openView("recent");
    await screen.findByText("Báo giá.docx");
    await waitFor(() =>
      expect(groupHeaders()).toEqual([
        `${t("documents.home.groups.type.folder")}2`,
        `${t("documents.home.groups.unfiled")}1`,
        "Dự án CCB1",
      ]),
    );
    const groupBody = (headerText: string) => {
      const header = Array.from(document.querySelectorAll("[data-library-group]")).find(
        (cell) => cell.textContent === headerText,
      );
      const tbody = header?.closest("tbody");
      if (!tbody) throw new Error(`no tbody for group ${headerText}`);
      return tbody;
    };
    const foldersGroup = groupBody(`${t("documents.home.groups.type.folder")}2`);
    const unfiledGroup = groupBody(`${t("documents.home.groups.unfiled")}1`);
    expect(within(foldersGroup).getByText("Dự án CCB")).toBeInTheDocument();
    expect(within(foldersGroup).getByText("Thư mục trống")).toBeInTheDocument();
    expect(within(unfiledGroup).queryByText("Dự án CCB")).toBeNull();
    expect(within(unfiledGroup).queryByText("Thư mục trống")).toBeNull();
    expect(within(unfiledGroup).getByText("Kế hoạch Q4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: t("documents.home.group_by.label") }));
    const option = within(await screen.findByRole("listbox")).getByText(t("documents.home.group_by.type"));
    // Base UI only commits a click that started on the item with a pointer.
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    await waitFor(() =>
      expect(groupHeaders()).toEqual([
        `${t("documents.home.groups.type.page")}1`,
        `${t("documents.home.groups.type.folder")}2`,
        `${t("documents.home.groups.type.docx")}1`,
      ]),
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

    await openView("trash");

    expect(await screen.findByText(t("documents.library.permission_title"))).toBeInTheDocument();
  });

  it("loads the recent and shared views from their own endpoints", async () => {
    route({
      list: (path) => {
        if (path.startsWith(`${LIST_BASE}/recent`)) return [summary({ id: "r1", title: "Mở gần đây" })];
        if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return [summary({ id: "s1", title: "Được chia sẻ" })];
        return [];
      },
    });
    renderView(vi.fn());
    await screen.findByText(t("documents.home.empty.title"));

    await openView("recent");
    expect(await screen.findByText("Mở gần đây")).toBeInTheDocument();

    await openView("shared");
    expect(await screen.findByText("Được chia sẻ")).toBeInTheDocument();
  });

  it("navigates into a folder from its card, lists its children and renames it on the breadcrumb", async () => {
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

    const section = await screen.findByRole("region", { name: sectionName("folders") });
    fireEvent.click(await within(section).findByRole("button", { name: /^Dự án CCB/ }));

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

  it("creates a page from its Tạo nhanh pill and opens it", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], post: () => ({ document: summary() }) });
    renderView(onOpen);

    fireEvent.click(await pillButton("page"));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d1"));
    const call = postCall("POST");
    expect(call?.[0]).toBe(LIST_BASE);
    expect((call?.[1] as { body?: { title?: string } }).body?.title).toBe(t("documents.page.new_page"));
  });

  it("creates a blank file with its default name from a pill, then opens the editor", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], post: () => ({ document: file("n1", t("documents.home.default_names.docx")) }) });
    renderView(onOpen);

    fireEvent.click(await pillButton("docx"));

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

  it("disables a pill the server cannot create yet instead of failing the page", async () => {
    route({
      list: () => [],
      post: () => {
        throw new ApiError("not found", "not_found", 404);
      },
    });
    renderView(vi.fn());

    const pptx = await pillButton("pptx");
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
    expect(screen.queryByRole("region", { name: t("documents.home.quick_create.label") })).toBeNull();
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

    // Create, close, open and fetch the folder chain past the 1s default under the full CI run.
    const crumbs = await screen.findByRole("navigation", { name: t("documents.home.breadcrumb_label") }, { timeout: 5000 });
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
    // The board has no Source column; the owner name rides the secondary line until its column joins.
    expect(within(row).getAllByText("Dũng").length).toBeGreaterThan(0);
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

  it("shows a file's size in the Dung lượng column", async () => {
    route({
      list: () => [
        summary({ id: "u1", kind: "file", title: "Hợp đồng.pdf", size_bytes: 2048, origin: "upload" }),
        summary({ id: "c1", kind: "file", title: "Báo cáo.docx", size_bytes: 0, origin: "created" }),
      ],
    });
    renderView(vi.fn());
    const uploaded = await rowOf("Hợp đồng.pdf");
    expect(within(uploaded).getAllByText(/2 KB/).length).toBeGreaterThan(0);
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
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Hợp đồng" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    await waitFor(() => {
      const call = postCall("POST");
      expect(call?.[0]).toBe("/api/v1/documents/d1/move");
      expect((call?.[1] as { body?: unknown }).body).toEqual({ parent_id: "f1", revision: "7" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps a refused move in the dialog with the localized reason, and shows a folder and its subtree as aria-disabled", async () => {
    route({
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      tree: () => [
        treeNode({ id: "f1", title: "Hợp đồng", kind: "folder", children: [treeNode({ id: "f2", title: "Con", kind: "folder", parent_id: "f1" })] }),
        treeNode({ id: "f3", title: "Tài chính", kind: "folder" }),
      ],
      detail: (id) => summary({ id, kind: "folder", revision: "2" }),
      post: () => {
        throw new ApiError("server text", "document_parent_kind", 422);
      },
    });
    renderView(vi.fn());
    await openFolderMenu("Hợp đồng");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("treeitem", { name: "Hợp đồng" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("treeitem", { name: "Con" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(within(dialog).getByRole("treeitem", { name: "Tài chính" }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.move.submit") }));
    expect(await within(dialog).findByText(t("documents.errors.document_parent_kind"))).toBeInTheDocument();
  });

  it("says archiving a folder takes everything in it", async () => {
    route({
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder" })],
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
    });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/f1/archive-impact"
        ? Promise.resolve({ folders: 2, documents: 3, total: 6, max_nodes: 1000, too_large: false })
        : base(path, opts),
    );
    renderView(vi.fn());
    await openFolderMenu("Hợp đồng");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.archive.delete_title"))).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        t("documents.archive.delete_body", {
          subfolders: t("documents.archive.delete_subfolders", { count: 2 }),
          documents: t("documents.archive.delete_documents", { count: 3 }),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("offers no row menu in the trash, and no move or archive on the shared view", async () => {
    route({ list: () => [summary()] });
    renderView(vi.fn());
    await openView("trash");
    expect(await screen.findByRole("heading", { level: 1, name: t("documents.trash.title") })).toBeInTheDocument();
    await screen.findByText("Kế hoạch Q4");
    // The trash table has Khôi phục instead of a ⋯ menu.
    expect(screen.queryByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();

    await openView("shared");
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") });
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.archive") })).toBeNull();
  });

  it("gates Move and Archive by the level of each row, not by the open folder", async () => {
    route({
      list: () => [
        summary({ id: "m1", title: "Báo cáo quản lý", my_level: "manage" }),
        summary({ id: "e1", title: "Tài liệu được sửa", my_level: "edit" }),
        summary({ id: "v1", title: "Tài liệu chỉ đọc", my_level: "view" }),
        summary({ id: "n1", title: "Chưa rõ", my_level: undefined }),
      ],
    });
    renderView(vi.fn());
    const menuItems = async (title: string) => {
      const row = await rowOf(title);
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
      await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") });
      const has = (key: string) => screen.queryByRole("menuitem", { name: t(key) }) !== null;
      const out = { move: has("documents.tree.menu.move_to"), archive: has("documents.home.row.archive") };
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menuitem", { name: t("documents.home.row.open_web") })).toBeNull());
      return out;
    };
    expect(await menuItems("Báo cáo quản lý")).toEqual({ move: true, archive: true });
    expect(await menuItems("Tài liệu được sửa")).toEqual({ move: true, archive: false });
    expect(await menuItems("Tài liệu chỉ đọc")).toEqual({ move: false, archive: false });
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
    await waitFor(() => expect(launch).toHaveBeenCalledWith("uniwork-office://home", expect.anything()));
    expect(postCall("POST")).toBeUndefined();
  });

  it("says a chat file says View where attached, and offers no save for a file the server will not copy", async () => {
    route({ list: () => [], sources: () => [source({ can_save: false })] });
    renderView(vi.fn());
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Đề xuất ngân sách.pdf" }) }));
    expect(await screen.findByRole("menuitem", { name: "Xem nơi đính kèm" })).toBeInTheDocument();
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

  it("disables move targets past the depth limit with the localized reason", async () => {
    const chain = (level: number): ReturnType<typeof treeNode> =>
      treeNode({
        id: `l${level}`,
        title: `Cấp ${level}`,
        kind: "folder",
        children: level < TREE_MAX_LEVEL ? [chain(level + 1)] : [],
      });
    route({
      list: () => [summary({ id: "d1" })],
      tree: () => [chain(1), treeNode({ id: "d1", title: "Kế hoạch Q4", children: [treeNode({ id: "d2", title: "Con" })] })],
    });
    renderView(vi.fn());
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") }));
    const dialog = await screen.findByRole("dialog");
    // A page with one child takes two levels: TREE_MAX_LEVEL - 2 is the deepest enabled target.
    expect(within(dialog).getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 2}` })).not.toHaveAttribute("aria-disabled");
    const tooDeep19 = within(dialog).getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL - 1}` });
    const tooDeep20 = within(dialog).getByRole("treeitem", { name: `Cấp ${TREE_MAX_LEVEL}` });
    expect(tooDeep19).toHaveAttribute("aria-disabled", "true");
    expect(tooDeep19).toHaveAccessibleDescription(t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL }));
    expect(tooDeep20).toHaveAttribute("aria-disabled", "true");
    expect(tooDeep20).toHaveAccessibleDescription(t("documents.home.move.reason_too_deep", { max: TREE_MAX_LEVEL }));
  });

  it("explains a folder too large to archive at once", async () => {
    route({
      tree: () => [treeNode({ id: "f1", title: "Hợp đồng", kind: "folder" })],
      list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })],
      post: () => {
        throw new ApiError("server text", "folder_too_large", 422);
      },
    });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/f1/archive-impact"
        ? Promise.resolve({ folders: 0, documents: 0, total: 1, max_nodes: 1000, too_large: false })
        : base(path, opts),
    );
    renderView(vi.fn());
    await openFolderMenu("Hợp đồng");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.tree.menu.delete") }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: t("documents.archive.delete_confirm") });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await within(dialog).findByText(t("documents.errors.folder_too_large"))).toBeInTheDocument();
  });

  it("uploads a file from the header button and opens the new document", async () => {
    const onOpen = vi.fn();
    route({ list: () => [], upload: () => ({ document: file("d2", "note.txt") }) });
    renderView(onOpen);

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
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

    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.create.upload.button") }));
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

  describe("folder contents list (FD-08)", () => {
    const rowOrder = () =>
      Array.from(document.querySelectorAll("[data-library-row]")).map((tr) =>
        tr.getAttribute("data-library-row"),
      );

    async function selectFolderSort(optionLabel: string) {
      fireEvent.click(screen.getByRole("combobox", { name: t("documents.home.sort.label") }));
      const option = within(await screen.findByRole("listbox")).getByText(optionLabel);
      fireEvent.pointerDown(option);
      fireEvent.click(option);
    }

    it("keeps subfolders out of the rows, as cards above the table, in both sorts", async () => {
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "Dự án CCB",
            kind: "folder",
            children: [
              treeNode({ id: "fol-old", title: "Zebra", kind: "folder", parent_id: "fo1" }),
              treeNode({ id: "fol-new", title: "Alpha", kind: "folder", parent_id: "fo1" }),
            ],
          }),
        ],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [
                summary({ id: "doc-new", parent_id: "fo1", kind: "page", title: "Zulu", updated_at: "2026-10-10T00:00:00Z" }),
                summary({ id: "fol-old", parent_id: "fo1", kind: "folder", title: "Zebra", updated_at: "2026-01-01T00:00:00Z" }),
                file("doc-old", "Báo cáo.docx", { parent_id: "fo1", updated_at: "2026-02-01T00:00:00Z" }),
                summary({ id: "fol-new", parent_id: "fo1", kind: "folder", title: "Alpha", updated_at: "2026-09-01T00:00:00Z" }),
              ]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      const subfolders = await screen.findByRole("region", { name: sectionName("subfolders") });
      await within(subfolders).findByRole("button", { name: /^Zebra/ });
      expect(within(subfolders).getByRole("button", { name: /^Alpha/ })).toBeInTheDocument();
      await screen.findByText("Zulu");
      // Newest update first; the folders are cards, never rows.
      expect(rowOrder()).toEqual(["doc-new", "doc-old"]);

      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["doc-old", "doc-new"]));
      expect(within(subfolders).getByRole("button", { name: /^Zebra/ })).toBeInTheDocument();
    });

    it("sorts by Name using Vietnamese collation ('Ă' after 'A')", async () => {
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [
                summary({ id: "binh", parent_id: "fo1", kind: "page", title: "Bình", updated_at: "2026-10-04T00:00:00Z" }),
                summary({ id: "an-circumflex", parent_id: "fo1", kind: "page", title: "Ân", updated_at: "2026-10-03T00:00:00Z" }),
                summary({ id: "an-breve", parent_id: "fo1", kind: "page", title: "Ăn", updated_at: "2026-10-02T00:00:00Z" }),
                summary({ id: "an-plain", parent_id: "fo1", kind: "page", title: "An", updated_at: "2026-10-01T00:00:00Z" }),
              ]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });
      await screen.findByText("Bình");

      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["an-plain", "an-breve", "an-circumflex", "binh"]));
    });

    it("keeps the chosen sort on the control and in storage after going to root (control unmounts) and opening another folder (V-F1)", async () => {
      const setItemSpy = vi.spyOn(defaultStorage, "setItem");
      route({
        tree: () => [
          treeNode({ id: "fo1", title: "Thư mục A", kind: "folder" }),
          treeNode({ id: "fo2", title: "Thư mục B", kind: "folder" }),
        ],
        detail: (id) =>
          id === "fo1"
            ? folderDetail({ id: "fo1", title: "Thư mục A" })
            : id === "fo2"
              ? folderDetail({ id: "fo2", title: "Thư mục B" })
              : null,
        list: (path) => {
          const pid = queryOf(path).get("parent_id");
          if (pid === "fo1") {
            return [
              summary({ id: "a-z", parent_id: "fo1", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "a-a", parent_id: "fo1", title: "Alpha", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          if (pid === "fo2") {
            return [
              summary({ id: "b-an-breve", parent_id: "fo2", title: "Ăn", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "b-an", parent_id: "fo2", title: "An", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          return [summary({ id: "root-doc", title: "Tài liệu gốc" })];
        },
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });
      await screen.findByText("Zeta");
      expect(rowOrder()).toEqual(["a-z", "a-a"]);

      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["a-a", "a-z"]));

      // Go to root so the sort Select unmounts and the home filters mount, then open another folder.
      const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
      fireEvent.click(within(crumbs).getByRole("button", { name: t("documents.home.sidebar.home") }));
      await screen.findByText("Tài liệu gốc");
      expect(screen.queryByRole("combobox", { name: t("documents.home.sort.label") })).toBeNull();
      expect(screen.getByRole("combobox", { name: new RegExp(`^${escape(t("documents.home.filters.type"))}`) })).toBeInTheDocument();

      setItemSpy.mockClear();
      fireEvent.click(screen.getByRole("treeitem", { name: /Thư mục B/ }));
      await screen.findByText("Ăn");
      expect(screen.getByRole("combobox", { name: t("documents.home.sort.label") })).toHaveTextContent(
        t("documents.home.sort.name"),
      );
      expect(rowOrder()).toEqual(["b-an", "b-an-breve"]);
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(defaultStorage.getItem(userFolderSortKey("u1"))).toBe("name");
      setItemSpy.mockRestore();
    });

    it("persists the sort choice under one per-viewer key (uniwork_documents_folder_sort:<userId>), isolates viewers, and does not write without a user (F2)", async () => {
      const setItemSpy = vi.spyOn(defaultStorage, "setItem");
      route({
        tree: () => [
          treeNode({ id: "fo1", title: "Thư mục A", kind: "folder" }),
          treeNode({ id: "fo2", title: "Thư mục B", kind: "folder" }),
        ],
        detail: (id) =>
          id === "fo1"
            ? folderDetail({ id: "fo1", title: "Thư mục A" })
            : id === "fo2"
              ? folderDetail({ id: "fo2", title: "Thư mục B" })
              : null,
        list: (path) => {
          const pid = queryOf(path).get("parent_id");
          if (pid === "fo1") {
            return [
              summary({ id: "a-z", parent_id: "fo1", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "a-a", parent_id: "fo1", title: "Alpha", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          if (pid === "fo2") {
            return [
              summary({ id: "b-an-breve", parent_id: "fo2", title: "Ăn", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "b-an", parent_id: "fo2", title: "An", updated_at: "2026-01-01T00:00:00Z" }),
            ];
          }
          return [];
        },
      });
      const { unmount } = renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });
      await screen.findByText("Zeta");
      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["a-a", "a-z"]));
      expect(defaultStorage.getItem(userFolderSortKey("u1"))).toBe("name");
      expect(setItemSpy).toHaveBeenCalledWith(userFolderSortKey("u1"), "name");

      fireEvent.click(screen.getByRole("treeitem", { name: /Thư mục B/ }));
      await screen.findByText("Ăn");
      expect(rowOrder()).toEqual(["b-an", "b-an-breve"]);

      // A second viewer on the same browser does not share u1's choice, and no user neither reads nor writes.
      unmount();
      setSessionUser({
        id: "u2",
        email: "binh@example.com",
        display_name: "Bình",
        onboarded_at: "2026-08-25T00:00:00Z",
        email_verified_at: "2026-08-25T00:00:00Z",
        onboarding_questionnaire: {},
        locale: "vi",
      });
      const second = renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo2` });
      await screen.findByText("Ăn");
      expect(rowOrder()).toEqual(["b-an-breve", "b-an"]);
      expect(defaultStorage.getItem(userFolderSortKey("u2"))).toBeNull();
      second.unmount();

      resetAuthStoreForTests();
      setItemSpy.mockClear();
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo2` });
      await screen.findByText("Ăn");
      expect(rowOrder()).toEqual(["b-an-breve", "b-an"]);
      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["b-an", "b-an-breve"]));
      expect(setItemSpy).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
    });

    it("loads all pages of an open folder before applying sort (F4)", async () => {
      const urls: string[] = [];
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "Dự án CCB",
            kind: "folder",
            children: [treeNode({ id: "fol-p2", title: "Thư mục trang 2", kind: "folder", parent_id: "fo1" })],
          }),
        ],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) => {
          urls.push(path);
          const pid = queryOf(path).get("parent_id");
          const cur = queryOf(path).get("cursor");
          if (pid === "fo1") {
            if (cur === "c2") {
              return [
                summary({ id: "fol-p2", parent_id: "fo1", kind: "folder", title: "Thư mục trang 2", updated_at: "2026-01-01T00:00:00Z" }),
                summary({ id: "doc-p2", parent_id: "fo1", kind: "page", title: "Bình", updated_at: "2026-05-01T00:00:00Z" }),
              ];
            }
            return [
              summary({ id: "doc-p1-new", parent_id: "fo1", kind: "page", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              summary({ id: "doc-p1-old", parent_id: "fo1", kind: "page", title: "An", updated_at: "2026-08-01T00:00:00Z" }),
            ];
          }
          return [];
        },
        cursor: (path) => {
          const pid = queryOf(path).get("parent_id");
          const cur = queryOf(path).get("cursor");
          if (pid === "fo1") return cur === "c2" ? null : "c2";
          return null;
        },
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      // Without clicking Load more, page 2 is auto-loaded: its document joins the rows (newest first)
      // and its folder is a card, not a row.
      await screen.findByText("Bình");
      expect(rowOrder()).toEqual(["doc-p1-new", "doc-p1-old", "doc-p2"]);
      expect(screen.queryByRole("button", { name: t("documents.library.load_more") })).toBeNull();
      const subfolders = screen.getByRole("region", { name: sectionName("subfolders") });
      expect(within(subfolders).getByRole("button", { name: /^Thư mục trang 2/ })).toBeInTheDocument();

      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["doc-p1-old", "doc-p2", "doc-p1-new"]));
    });

    // The 1000-row cap lives on the rows useDocumentsLibrary returns; driving it
    // through the page rendered 1000 rows and needed a 90 s timeout, so the same
    // assertions run on the hook instead (same route stub, no DOM).
    it("stops an open folder's auto-paging at the 1000-row cap and keeps load-more working (F4)", async () => {
      const urls: string[] = [];
      route({
        tree: () => [treeNode({ id: "fo-cap", title: "Thư mục lớn", kind: "folder" })],
        list: (path) => {
          urls.push(path);
          const cur = queryOf(path).get("cursor");
          const batch = cur === "cap2" ? 500 : cur === "cap3" ? 1000 : 0;
          return Array.from({ length: 500 }, (_, i) => {
            const n = batch + i + 1;
            return summary({ id: `cap-${n}`, parent_id: "fo-cap", title: `Tài liệu ${n}`, updated_at: "2026-10-01T00:00:00Z" });
          });
        },
        cursor: (path) => {
          const cur = queryOf(path).get("cursor");
          return !cur ? "cap2" : cur === "cap2" ? "cap3" : null;
        },
      });
      const { result } = renderHook(
        () => useDocumentsLibrary({ wsId: WS, orgId: "org1", enabled: true, view: { kind: "home" }, folderId: "fo-cap", chip: "all" }),
        { wrapper: (props: { children: React.ReactNode }) => wrap(<>{props.children}</>) },
      );

      // Auto-pages fetch 500 + 500 = 1000 and stop before cap3.
      await waitFor(() => expect(result.current.state.rows).toHaveLength(1000));
      expect(result.current.state.loading).toBe(false);
      expect(urls.some((u) => queryOf(u).get("cursor") === "cap2")).toBe(true);
      expect(urls.some((u) => queryOf(u).get("cursor") === "cap3")).toBe(false);

      // The cap does not lock the list: manual load-more still fetches page 3.
      expect(result.current.state.hasMore).toBe(true);
      act(() => result.current.state.loadMore());
      await waitFor(() => expect(result.current.state.rows).toHaveLength(1500));
      expect(urls.some((u) => queryOf(u).get("cursor") === "cap3")).toBe(true);
    });

    it("lists direct children only and excludes grandchildren or root documents", async () => {
      const urls: string[] = [];
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "Dự án CCB",
            kind: "folder",
            children: [treeNode({ id: "sub1", title: "Con trực tiếp", kind: "folder", parent_id: "fo1" })],
          }),
        ],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) => {
          urls.push(path);
          return [
            summary({ id: "sub1", parent_id: "fo1", kind: "folder", title: "Con trực tiếp" }),
            file("direct-doc", "Tài liệu con.docx", { parent_id: "fo1" }),
            file("grandchild-doc", "Tài liệu cháu.docx", { parent_id: "sub1" }),
            summary({ id: "root-doc", parent_id: null, title: "Tài liệu gốc" }),
          ];
        },
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      const table = await screen.findByRole("table");
      const subfolders = await screen.findByRole("region", { name: sectionName("subfolders") });
      expect(await within(subfolders).findByRole("button", { name: /^Con trực tiếp/ })).toBeInTheDocument();
      expect(within(table).queryByText("Con trực tiếp")).toBeNull();
      expect(within(table).getByText("Tài liệu con.docx")).toBeInTheDocument();
      expect(within(table).queryByText("Tài liệu cháu.docx")).toBeNull();
      expect(within(table).queryByText("Tài liệu gốc")).toBeNull();
      expect(urls.some((u) => queryOf(u).get("parent_id") === "fo1")).toBe(true);
    });

    it("keeps root and folder apart per FD-D9: filters and no sort at root, sort and no filters in a folder, never grouped", async () => {
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [file("f1", "Báo giá.docx", { parent_id: "fo1" })]
            : [summary({ id: "d1", title: "Kế hoạch Q4" }), file("f1", "Báo giá.docx", { parent_id: "fo1" })],
      });
      renderView(vi.fn());
      await screen.findByText("Báo giá.docx");

      expect(screen.queryByRole("combobox", { name: t("documents.home.sort.label") })).toBeNull();
      expect(screen.getByRole("combobox", { name: new RegExp(`^${escape(t("documents.home.filters.type"))}`) })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: t("documents.home.group_by.label") })).toBeNull();
      expect(screen.queryByRole("columnheader", { name: t("documents.home.columns.type") })).toBeNull();
      const groupHeaders = () => Array.from(document.querySelectorAll("[data-library-group]")).map((c) => c.textContent);
      // The home table is flat: no "Chưa phân loại" / folder group headings.
      expect(groupHeaders()).toEqual([]);

      fireEvent.click(screen.getByRole("treeitem", { name: /Dự án CCB/ }));
      expect(await screen.findByRole("combobox", { name: t("documents.home.sort.label") })).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: new RegExp(`^${escape(t("documents.home.filters.type"))}`) })).toBeNull();
      expect(screen.queryByRole("combobox", { name: t("documents.home.group_by.label") })).toBeNull();
      // Same six board columns inside a folder (F-7): Truy cập, never Loại.
      expect(screen.queryByRole("columnheader", { name: t("documents.home.columns.type") })).toBeNull();
      expect(await screen.findByRole("columnheader", { name: t("documents.home.columns.access") })).toBeInTheDocument();
      expect(groupHeaders()).toEqual([]);
    });

    it("renders CollectionPageState when an open folder is empty and offers a New folder action when the viewer can create (V-F3)", async () => {
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: () => [],
        post: () => ({ document: folderDetail({ id: "fo-sub", parent_id: "fo1", title: "Thư mục con mới" }) }),
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      const emptyTitle = await screen.findByText(t("documents.home.empty.folder_title"));
      expect(emptyTitle).toBeInTheDocument();
      const status = emptyTitle.closest("[role='status']") as HTMLElement;
      expect(status).toHaveTextContent(t("documents.home.empty.description"));
      expect(screen.getByRole("combobox", { name: t("documents.home.sort.label") })).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();

      const createFolderBtn = within(status).getByRole("button", { name: t("documents.home.folders.create_title") });
      fireEvent.click(createFolderBtn);
      const dialog = await screen.findByRole("dialog", {
        name: t("documents.home.folders.create_sub_title", { parent: "Dự án CCB" }),
      });
      const input = within(dialog).getByLabelText(t("documents.home.folders.rename_label"));
      fireEvent.change(input, { target: { value: "Thư mục con mới" } });
      fireEvent.click(within(dialog).getByRole("button", { name: t("documents.home.folders.create_submit") }));
      await waitFor(() => {
        expect((postCall("POST")?.[1] as { body?: unknown }).body).toEqual({
          kind: "folder",
          title: "Thư mục con mới",
          parent_id: "fo1",
        });
      });
    });


    it("defaults sort without crashing when platform storage throws", async () => {
      const getSpy = vi.spyOn(defaultStorage, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      const setSpy = vi.spyOn(defaultStorage, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      route({
        tree: () => [treeNode({ id: "fo1", title: "Dự án CCB", kind: "folder" })],
        detail: (id) => (id === "fo1" ? folderDetail({ id: "fo1", title: "Dự án CCB" }) : null),
        list: (path) =>
          queryOf(path).get("parent_id") === "fo1"
            ? [
                summary({ id: "d-old", parent_id: "fo1", title: "An", updated_at: "2026-01-01T00:00:00Z" }),
                summary({ id: "d-new", parent_id: "fo1", title: "Zeta", updated_at: "2026-10-10T00:00:00Z" }),
              ]
            : [],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo1` });

      await screen.findByText("Zeta");
      expect(rowOrder()).toEqual(["d-new", "d-old"]);

      await selectFolderSort(t("documents.home.sort.name"));
      await waitFor(() => expect(rowOrder()).toEqual(["d-old", "d-new"]));

      getSpy.mockRestore();
      setSpy.mockRestore();
    });

    it("gives every breadcrumb button and, on the Recent view, every toolbar chip a 44x44 coarse-pointer floor (V-F6 / N3)", async () => {
      route({
        tree: () => [
          treeNode({
            id: "fo1",
            title: "An",
            kind: "folder",
            children: [treeNode({ id: "fo2", title: "Dự án CCB", kind: "folder", parent_id: "fo1" })],
          }),
        ],
        detail: (id) =>
          id === "fo2"
            ? folderDetail({ id: "fo2", title: "Dự án CCB", parent_id: "fo1", breadcrumbs: [{ id: "fo1", title: "An" }] })
            : null,
        list: () => [summary({ id: "d1", parent_id: "fo2", title: "Kế hoạch Q4" })],
      });
      renderView(vi.fn(), { initialUrl: `/org/${WS}/documents?folder=fo2` });
      await screen.findByText("Kế hoạch Q4");

      // A folder has no type chips and no scope tabs, only the breadcrumb.
      expect(screen.queryByRole("group", { name: t("documents.home.chips_label") })).toBeNull();
      const crumbs = screen.getByRole("navigation", { name: t("documents.home.breadcrumb_label") });
      for (const btn of within(crumbs).getAllByRole("button")) {
        expect(btn).toHaveClass("pointer-coarse:min-w-11", "pointer-coarse:min-h-11");
      }

      await openView("recent");
      const chipGroup = await screen.findByRole("group", { name: t("documents.home.chips_label") });
      const chips = within(chipGroup).getAllByRole("button");
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) {
        expect(chip).toHaveClass("h-7", "px-3", "pointer-coarse:min-w-11", "pointer-coarse:min-h-11");
      }
    });

    // overflow-x-auto alone turns overflow-y into auto too, which grew a stray
    // vertical scrollbar (UNI-1752). The scope tabs are gone; the type chips
    // of the Recent view still scroll sideways only, with no visible scrollbar.
    it("keeps the type chips scrolling sideways only, without a visible scrollbar", async () => {
      route({ list: () => [summary({ id: "d1", title: "Kế hoạch Q4" })] });
      renderView(vi.fn());
      await screen.findByText("Kế hoạch Q4");
      await openView("recent");

      const chipGroup = await screen.findByRole("group", { name: t("documents.home.chips_label") });
      expect(chipGroup).toHaveClass("overflow-x-auto", "overflow-y-hidden", "no-scrollbar");
    });
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

/** A pill of the Tạo nhanh strip at the home root. */
async function pillButton(type: string) {
  const strip = await screen.findByRole("region", { name: t("documents.home.quick_create.label") });
  return within(strip).getByRole("button", { name: new RegExp(escape(t(`documents.home.create.${type}.chip`))) });
}

const typeSelect = () => new RegExp(`^${escape(t("documents.home.filters.type"))}`);

/** Opens a Select by its trigger name and commits an option. */
async function choose(comboboxName: string | RegExp, option: string | RegExp) {
  fireEvent.click(await screen.findByRole("combobox", { name: comboboxName }));
  const optionEl = within(await screen.findByRole("listbox")).getByText(option);
  // Base UI only commits a click that started on the item with a pointer.
  fireEvent.pointerDown(optionEl);
  fireEvent.click(optionEl);
}

/** Switches the view through the sidebar nav (the scope tabs are gone). */
async function openView(view: "home" | "recent" | "starred" | "shared" | "trash") {
  const buttons = await screen.findAllByRole("button", { name: t(`documents.home.sidebar.${view}`) });
  fireEvent.click(buttons[0]!);
}

/** The section regions are named by their h2, which carries the count ("Thư mục 1"). */
function sectionName(key: "folders" | "subfolders" | "documents") {
  return new RegExp(`^${escape(t(`documents.home.sections.${key}`))} [0-9]+$`);
}

/** Opens the ⋯ menu of a folder card (folders are cards, never table rows). */
async function openFolderMenu(title: string, regionName: RegExp = sectionName("folders")) {
  const section = await screen.findByRole("region", { name: regionName });
  fireEvent.click(await within(section).findByRole("button", { name: t("documents.home.row.menu", { title }) }));
}

async function rowOf(title: string) {
  const table = await screen.findByRole("table");
  const name = await within(table).findByText(title);
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
