import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// UNI-2045 W8: one row menu for every live list. The ⋯ dropdown and the
// right-click menu are drawn from the same ordered groups (doclist/row-menu.ts),
// and the three new commands run through the existing hooks and endpoints.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const downloadBlob = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
    requestBlob: (...args: unknown[]) => downloadBlob(...args),
  };
});

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
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
    organization_id: "org1",
    workspace_id: WS,
    kind: "file",
    format: "docx",
    title: "Báo cáo.docx",
    revision: "1",
    current_version: 1,
    my_level: "manage",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function route(rows: unknown[], over: { post?: (path: string) => unknown; shared?: unknown[] } = {}) {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    const method = opts?.method ?? "GET";
    if (path.startsWith("/api/v1/config")) return Promise.resolve({ flags: { office_engine: true } });
    if (path.includes("/documents/favorites")) return Promise.resolve({ favorites: [] });
    if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") return Promise.resolve({ items: [], next_cursor: null });
    if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return Promise.resolve({ documents: over.shared ?? [], next_cursor: null });
    if (method === "POST") return Promise.resolve(over.post?.(path) ?? {});
    if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: rows, next_cursor: null });
    return Promise.resolve({});
  });
}

function nav(): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(),
    getShareableUrl: (p) => p,
  };
}

function renderView() {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={nav()}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
}

async function rowOf(title: string) {
  const row = (await screen.findByText(title)).closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

async function openDropdown(title: string) {
  const row = await rowOf(title);
  fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  return screen.findByRole("menu");
}

async function openContext(title: string) {
  fireEvent.contextMenu(await rowOf(title));
  return screen.findByRole("menu");
}

const labelsOf = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((el) => el.textContent?.trim());
const separatorsOf = (menu: HTMLElement) => menu.querySelectorAll('[role="separator"]');
const calls = (method: string) => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === method);

const FILE_MENU = [
  t("documents.tree.menu.open"),
  t("documents.home.row.open_app"),
  t("documents.actions.share"),
  t("documents.list.menu.copy_link"),
  t("documents.home.row.star"),
  t("documents.home.row.rename"),
  t("documents.home.row.move"),
  t("documents.actions.copy"),
  t("documents.home.row.download"),
  t("documents.shelved_list.shelve"),
  t("documents.home.row.archive"),
];

beforeEach(() => {
  requestMock.mockReset();
  downloadBlob.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  toast.dismiss.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
});

describe("one list, two primitives", () => {
  it("shows the same items, in the same order, in the ⋯ dropdown and the right-click menu", async () => {
    route([summary()]);
    renderView();
    const dropdown = await openDropdown("Báo cáo.docx");
    // Without a desktop host the app item is absent; every other contract item is there in order.
    const expected = FILE_MENU.filter((label) => label !== t("documents.home.row.open_app"));
    expect(labelsOf(dropdown)).toEqual(expected);
    fireEvent.keyDown(dropdown, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(labelsOf(await openContext("Báo cáo.docx"))).toEqual(expected);
  });

  it("draws a separator between the groups in both menus, none at the ends", async () => {
    route([summary()]);
    renderView();
    const dropdown = await openDropdown("Báo cáo.docx");
    // Open │ Share, Copy link │ Star … Download │ Archive, Trash: three separators with no app item.
    expect(separatorsOf(dropdown)).toHaveLength(3);
    expect(dropdown.firstElementChild?.getAttribute("role")).not.toBe("separator");
    expect(dropdown.lastElementChild?.getAttribute("role")).not.toBe("separator");
    fireEvent.keyDown(dropdown, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(separatorsOf(await openContext("Báo cáo.docx"))).toHaveLength(3);
  });

  it("puts the destructive item last with the destructive style, in both menus", async () => {
    route([summary()]);
    renderView();
    for (const open of [openDropdown, openContext]) {
      const menu = await open("Báo cáo.docx");
      const items = within(menu).getAllByRole("menuitem");
      const last = items[items.length - 1]!;
      expect(last).toHaveTextContent(t("documents.home.row.archive"));
      expect(last.getAttribute("data-variant")).toBe("destructive");
      expect(items.slice(0, -1).some((item) => item.getAttribute("data-variant") === "destructive")).toBe(false);
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
  });

  it("keeps the 44px touch target on every item of both menus", async () => {
    route([summary()]);
    renderView();
    for (const open of [openDropdown, openContext]) {
      const menu = await open("Báo cáo.docx");
      for (const item of within(menu).getAllByRole("menuitem")) expect(item.className).toContain("pointer-coarse:min-h-11");
      fireEvent.keyDown(menu, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    }
  });
});

describe("Shared with me", () => {
  it("hides Lưu trữ and the trash item without manage, shows them with it", async () => {
    route([], {
      shared: [summary({ id: "s1", title: "Chỉ sửa.docx", my_level: "edit" }), summary({ id: "s2", title: "Toàn quyền.docx", my_level: "manage" })],
    });
    renderView();
    fireEvent.click(screen.getAllByRole("button", { name: new RegExp(t("documents.home.sidebar.shared")) })[0]!);
    const edit = await openDropdown("Chỉ sửa.docx");
    expect(labelsOf(edit)).not.toContain(t("documents.home.row.archive"));
    expect(labelsOf(edit)).not.toContain(t("documents.shelved_list.shelve"));
    fireEvent.keyDown(edit, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    const manage = await openDropdown("Toàn quyền.docx");
    expect(labelsOf(manage)).toContain(t("documents.home.row.archive"));
    expect(labelsOf(manage)).toContain(t("documents.shelved_list.shelve"));
  });
});

describe("Chuyển vào thùng rác and Lưu trữ", () => {
  it("asks first for the trash item: no archive call until the dialog is confirmed", async () => {
    route([summary()]);
    renderView();
    const menu = await openDropdown("Báo cáo.docx");
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.home.row.archive") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(calls("POST").some(([path]) => String(path).endsWith("/archive"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.archive.archive_confirm") }));
    await waitFor(() => expect(calls("POST").some(([path]) => path === "/api/v1/documents/d1/archive")).toBe(true));
  });

  it("archives (Lưu trữ) at once, with no confirmation", async () => {
    route([summary()]);
    renderView();
    const menu = await openDropdown("Báo cáo.docx");
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.shelved_list.shelve") }));
    await waitFor(() => expect(calls("POST").some(([path]) => path === "/api/v1/documents/d1/shelve")).toBe(true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("Sao chép link", () => {
  it("copies the in-app document URL (never a public link) and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    route([summary()]);
    renderView();
    const menu = await openDropdown("Báo cáo.docx");
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.list.menu.copy_link") }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/acme/doi/documents/d1`));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.list.menu.link_copied")));
    // Copying a link makes no share link: nothing was posted.
    expect(calls("POST")).toHaveLength(0);
  });

  it("says when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    route([summary()]);
    renderView();
    const menu = await openDropdown("Báo cáo.docx");
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.list.menu.copy_link") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.list.menu.link_copy_failed")));
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("Tạo bản sao and Tải xuống", () => {
  it("duplicates through the existing copies endpoint after the consent the copy dialog asks for", async () => {
    route([summary()], { post: (path) => (path.endsWith("/copies") ? summary({ id: "d2", title: "Báo cáo (bản sao).docx" }) : {}) });
    renderView();
    const menu = await openDropdown("Báo cáo.docx");
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.actions.copy") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.copy.submit") }));
    await waitFor(() => expect(calls("POST").some(([path]) => path === "/api/v1/documents/d1/copies")).toBe(true));
    const body = calls("POST").find(([path]) => path === "/api/v1/documents/d1/copies")?.[1] as { body?: unknown } | undefined;
    expect(JSON.stringify(body?.body)).toContain("copy");
  });

  it("downloads the document's bytes through the existing download route, named after the file", async () => {
    route([summary()]);
    downloadBlob.mockResolvedValue(new Blob(["docx"]));
    const createUrl = vi.fn().mockReturnValue("blob:doc");
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    try {
      renderView();
      const menu = await openDropdown("Báo cáo.docx");
      fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.home.row.download") }));
      await waitFor(() => expect(clicked).toEqual(["Báo cáo.docx"]));
      expect(downloadBlob.mock.calls[0]?.[0]).toBe("/api/v1/documents/d1/download");
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("says why when the download is refused", async () => {
    route([summary()]);
    downloadBlob.mockRejectedValue("offline");
    renderView();
    const menu = await openDropdown("Báo cáo.docx");
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.home.row.download") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.download_failed")));
  });
});
