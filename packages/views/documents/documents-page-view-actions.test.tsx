import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import enLocale from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// The library's row commands and its views beyond the home root: download and
// go-to-source on a file from another module, starring, the Recent / Shared /
// Starred / Archived / Elsewhere views, and the navigation sheet below `xl`.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
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
  return { id: "d1", workspace_id: WS, kind: "page", title: "Kế hoạch Q4", revision: "1", my_level: "manage", updated_at: "2026-09-28T03:00:00Z", ...over };
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
  list?: (path: string) => unknown[];
  recent?: (path: string) => unknown[] | Promise<never>;
  recentCursor?: (path: string) => string | null;
  shared?: () => unknown[];
  favorites?: () => unknown[];
  sources?: (path: string) => unknown[];
  sourcesCursor?: (path: string) => string | null;
  post?: (path: string) => unknown;
  del?: (path: string) => unknown;
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
    if (path.includes("/documents/favorites")) return run(() => ({ favorites: routes.favorites?.() ?? [] }));
    if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(`${LIST_BASE}/sources`) && method === "GET") {
      return run(() => ({ items: routes.sources?.(path) ?? [], next_cursor: routes.sourcesCursor?.(path) ?? null }));
    }
    if (path.startsWith(`${LIST_BASE}/recent`)) {
      const rows = routes.recent?.(path);
      return Array.isArray(rows) || !rows ? Promise.resolve({ documents: rows ?? [], next_cursor: routes.recentCursor?.(path) ?? null }) : rows;
    }
    if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return run(() => ({ documents: routes.shared?.() ?? [], next_cursor: null }));
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (method === "DELETE") return run(() => routes.del?.(path) ?? { status: "ok" });
    if (path.startsWith(LIST_BASE)) return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: null }));
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

function renderView(adapter: NavigationAdapter = nav()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={adapter}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  return adapter;
}

async function rowOf(title: string) {
  const row = (await screen.findByText(title)).closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

async function pickFromMenu(title: string, item: string) {
  const row = await rowOf(title);
  fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

const calls = (method: string) => requestMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === method);
const sidebarItem = (label: string) => screen.getAllByRole("button", { name: new RegExp(label) })[0]!;

beforeEach(() => {
  requestMock.mockReset();
  downloadBlob.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
});

describe("file from another module", () => {
  it("downloads the blob through a temporary link named after the file", async () => {
    route({ sources: () => [source()] });
    downloadBlob.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    renderView();
    const createUrl = vi.fn().mockReturnValue("blob:budget");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const clicked: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(`${this.download}|${this.href}`);
    });
    try {
      const row = await rowOf("Đề xuất ngân sách.pdf");
      fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.download") }));
      await waitFor(() => expect(clicked).toHaveLength(1));
      expect(clicked[0]).toBe("Đề xuất ngân sách.pdf|blob:budget");
      expect(downloadBlob.mock.calls[0]?.[0]).toBe(`${LIST_BASE}/sources/chat%3Am1/download`);
      // The link is gone from the page and the object URL is released shortly after.
      expect(document.querySelector("a[download]")).toBeNull();
      await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:budget"), { timeout: 3000 });
      expect(toast.error).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("says why when the download is refused", async () => {
    route({ sources: () => [source()] });
    downloadBlob.mockRejectedValue(new ApiError("Tệp đã bị xoá", "not_found", 404));
    renderView();
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.download") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tệp đã bị xoá"));
  });

  it("falls back to the generic copy when the failure carries no message", async () => {
    route({ sources: () => [source()] });
    downloadBlob.mockRejectedValue("offline");
    renderView();
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.download") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.download_failed")));
  });

  it("opens the chat room and message that holds the file", async () => {
    route({
      sources: () => [
        source({ parent: { kind: "chat_channel", id: "c1", title: "Kênh chung", message_id: "m1" } }),
      ],
    });
    const adapter = renderView();
    await pickFromMenu("Đề xuất ngân sách.pdf", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/chat?room=c1&message=m1");
  });

  it("opens the task a comment attachment belongs to", async () => {
    route({ sources: () => [source({ id: "task:a1", source: "task", name: "Phụ lục.docx", extension: "docx", parent: { kind: "task", id: "t7", title: "Việc" } })] });
    const adapter = renderView();
    await pickFromMenu("Phụ lục.docx", t("documents.home.row.go_to_source"));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/tasks/t7");
  });

  it("goes nowhere for a parent the web app has no page for", async () => {
    route({ sources: () => [source({ parent: { kind: "unknown", id: "x", title: "?" } })] });
    const adapter = renderView();
    const row = await rowOf("Đề xuất ngân sách.pdf");
    fireEvent.click(within(row).getAllByRole("button", { name: /Đề xuất ngân sách.pdf/ })[0]!);
    expect(adapter.push).not.toHaveBeenCalled();
  });
});

describe("starring a document", () => {
  it("stars a row and reports a refused star", async () => {
    route({ list: () => [summary()], post: () => { throw new ApiError("Không có quyền", "forbidden", 403); } });
    renderView();
    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.star"));
    await waitFor(() => expect(calls("POST").some(([path]) => path === "/api/v1/documents/d1/favorite")).toBe(true));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không có quyền"));
  });

  it("offers the un-star on a starred row and calls the delete route", async () => {
    route({
      list: () => [summary()],
      favorites: () => [{ document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" }],
    });
    renderView();
    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.unstar"));
    await waitFor(() => expect(calls("DELETE").some(([path]) => path === "/api/v1/documents/d1/favorite")).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("uses the generic copy when the failure has no message", async () => {
    route({ list: () => [summary()], post: () => Promise.reject("offline") as never });
    renderView();
    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.star"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.home.row.star_failed")));
  });

  it("shows the starred count in the sidebar and lists the starred documents", async () => {
    route({
      list: () => [summary()],
      favorites: () => [{ document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" }, { document_id: "d9", workspace_id: "other", title: "Khác", kind: "page" }],
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    // A favourite of another workspace is not counted here.
    await waitFor(() => expect(within(sidebarItem(t("documents.home.sidebar.starred"))).getByText("1")).toBeInTheDocument());

    fireEvent.click(sidebarItem(t("documents.home.sidebar.starred")));
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.starred") })).toBeInTheDocument();
    expect(await rowOf("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Khác")).toBeNull();
  });

  it("shows the star marker on the row after starring and removes it after unstarring", async () => {
    let starred = false;
    const fav = { document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" };
    route({
      list: () => [summary()],
      favorites: () => (starred ? [fav] : []),
      post: (path) => {
        if (path === "/api/v1/documents/d1/favorite") starred = true;
        return { favorite: fav };
      },
      del: (path) => {
        if (path === "/api/v1/documents/d1/favorite") starred = false;
        return { status: "ok" };
      },
    });
    renderView();
    const row = await rowOf("Kế hoạch Q4");
    expect(within(row).queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull();

    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.star"));
    expect(await within(row).findByRole("img", { name: t("documents.home.row.starred") })).toBeInTheDocument();

    await pickFromMenu("Kế hoạch Q4", t("documents.home.row.unstar"));
    await waitFor(() => expect(within(row).queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull());
  });
});

describe("library views", () => {
  it("lists Recent and Shared with me from their own routes", async () => {
    route({
      list: () => [summary()],
      recent: () => [summary({ id: "r1", title: "Vừa mở" })],
      shared: () => [summary({ id: "s1", title: "Hợp đồng chung", updated_by: "agent-1", updated_by_kind: "agent" })],
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(sidebarItem(t("documents.home.sidebar.recent")));
    expect(await screen.findByText("Vừa mở")).toBeInTheDocument();
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();

    fireEvent.click(sidebarItem(t("documents.home.sidebar.shared")));
    const row = await rowOf("Hợp đồng chung");
    // An editor that is an agent without a member entry is named as an agent, not left blank.
    expect(within(row).getAllByText(t("documents.home.editor_agent")).length).toBeGreaterThan(0);
  });

  it("says the recent list could not be read and retries it", async () => {
    let attempts = 0;
    route({
      recent: () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError("boom", "internal", 500);
        return [summary({ id: "r1", title: "Vừa mở" })];
      },
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));
    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));
    expect(await screen.findByText("Vừa mở")).toBeInTheDocument();
  });

  it("pages Recent with Load more", async () => {
    const cursorOf = (path: string) => new URLSearchParams(path.split("?")[1] ?? "").get("cursor");
    route({
      recent: (path) => (cursorOf(path) === "c2" ? [summary({ id: "r2", title: "Mở hôm qua" })] : [summary({ id: "r1", title: "Vừa mở" })]),
      recentCursor: (path) => (cursorOf(path) === "c2" ? null : "c2"),
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));
    await screen.findByText("Vừa mở");
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    expect(await screen.findByText("Mở hôm qua")).toBeInTheDocument();
    expect(screen.getByText("Vừa mở")).toBeInTheDocument();
  });

  it("retries the starred list when it could not be read", async () => {
    let attempts = 0;
    route({
      favorites: () => {
        attempts += 1;
        if (attempts === 1) throw new ApiError("boom", "internal", 500);
        return [{ document_id: "d1", workspace_id: WS, title: "Kế hoạch Q4", kind: "page" }];
      },
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.starred")) }));
    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("separates a refusal from a failure", async () => {
    route({ recent: () => { throw new ApiError("no", "forbidden", 403); } });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));
    expect(await screen.findByText(t("documents.library.permission_title"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.library.error_title"))).toBeNull();
  });

  it("lists archived documents without move or archive commands", async () => {
    route({ list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [summary({ id: "a1", title: "Cũ", archived_at: "2026-09-01T00:00:00Z" })] : []) });
    renderView();
    fireEvent.click(await screen.findByRole("tab", { name: new RegExp(t("documents.home.scope.archived")) }));
    const row = await rowOf("Cũ");
    expect(within(row).getByText(t("documents.library.archived_badge"))).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Cũ" }) }));
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.archive") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeNull();
  });

  it("lists one module's files from the sidebar and names the view after it", async () => {
    const filters: string[] = [];
    route({
      list: () => [summary()],
      sources: (path) => {
        filters.push(path);
        return [source()];
      },
    });
    renderView();
    await screen.findByText("Kế hoạch Q4");
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.origin.chat") }));
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.home.views.chat") })).toBeInTheDocument();
    expect(filters.some((path) => new URLSearchParams(path.split("?")[1] ?? "").get("source") === "chat")).toBe(true);
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
    expect(await rowOf("Đề xuất ngân sách.pdf")).toBeInTheDocument();
  });

  it("pages one module's files with Load more", async () => {
    route({
      list: () => [summary()],
      sources: (path) => {
        const cursor = new URLSearchParams(path.split("?")[1] ?? "").get("cursor");
        if (cursor === "c2") return [source({ id: "chat:m2", name: "Phụ lục.pdf" })];
        return [source()];
      },
      sourcesCursor: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("cursor") === "c2" ? null : "c2"),
    });
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.home.origin.chat") }));
    await rowOf("Đề xuất ngân sách.pdf");

    fireEvent.click(await screen.findByRole("button", { name: t("documents.library.load_more") }));
    expect(await screen.findByText("Phụ lục.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.library.load_more") })).toBeNull();
  });

  it("shows the empty copy of the open view, not the home copy", async () => {
    route({});
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("documents.home.sidebar.shared")) }));
    expect(await screen.findByText(t("documents.home.empty.shared_title"))).toBeInTheDocument();
  });
});

describe("navigation sheet", () => {
  it("opens the same navigation below xl and closes it after a choice", async () => {
    route({ list: () => [summary()], recent: () => [summary({ id: "r1", title: "Vừa mở" })] });
    renderView();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.sidebar.open") }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText(t("documents.tree.sheet_title"))).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: new RegExp(t("documents.home.sidebar.recent")) }));

    expect(await screen.findByText("Vừa mở")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("FD-09 fix r2: trashed folder restore and one menu vocabulary", () => {
  const archivedFolder = (over: Record<string, unknown> = {}) =>
    summary({ id: "f1", kind: "folder", title: "Dự án CCB", archived_at: "2026-10-01T00:00:00Z", ...over });
  const archivedList = (rows: unknown[]) => (path: string) =>
    new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? rows : [];

  async function openArchiveScope() {
    fireEvent.click(await screen.findByRole("tab", { name: new RegExp(t("documents.home.scope.archived")) }));
  }

  /** The name button of the row's first cell (the row's primary action), or null when the cell is inert. */
  const primaryOf = (row: HTMLElement) => row.querySelector<HTMLElement>("td:first-child button");

  async function openMenu(title: string) {
    const row = await rowOf(title);
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  }

  it("offers Restore, not Open folder, on a trashed folder in the Archive scope", async () => {
    route({ list: archivedList([archivedFolder()]) });
    renderView();
    await openArchiveScope();
    await openMenu("Dự án CCB");
    expect(await screen.findByRole("menuitem", { name: t("documents.actions.restore") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.open_folder") })).toBeNull();
  });

  it("hides Restore from a viewer who cannot manage the trashed folder (no menu at all)", async () => {
    route({ list: archivedList([archivedFolder({ my_level: "edit" })]) });
    renderView();
    await openArchiveScope();
    const row = await rowOf("Dự án CCB");
    expect(within(row).queryByRole("button", { name: t("documents.home.row.menu", { title: "Dự án CCB" }) })).toBeNull();
  });

  it("opens the restore dialog, and does not navigate, on click of a trashed folder row", async () => {
    route({ list: archivedList([archivedFolder()]) });
    const adapter = renderView();
    await openArchiveScope();
    const row = await rowOf("Dự án CCB");
    fireEvent.click(primaryOf(row)!);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.archive.restore_title"))).toBeInTheDocument();
    expect(adapter.push).not.toHaveBeenCalledWith(expect.stringContaining("folder="));
  });

  it("opens the restore dialog, and does not navigate, on Enter over a trashed folder row", async () => {
    route({ list: archivedList([archivedFolder()]) });
    const adapter = renderView();
    await openArchiveScope();
    const row = await rowOf("Dự án CCB");
    const open = primaryOf(row)!;
    open.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(adapter.push).not.toHaveBeenCalledWith(expect.stringContaining("folder="));
  });

  it("makes a trashed folder row inert for a viewer who cannot manage it: no link, no dialog, no navigation", async () => {
    route({ list: archivedList([archivedFolder({ my_level: "edit" })]) });
    const adapter = renderView();
    await openArchiveScope();
    const row = await rowOf("Dự án CCB");
    expect(primaryOf(row)).toBeNull();
    fireEvent.click(within(row).getByText("Dự án CCB"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(adapter.push).not.toHaveBeenCalledWith(expect.stringContaining("folder="));
  });

  it("keeps an archived document's menu as it was: Open on the web, no Restore", async () => {
    route({ list: archivedList([summary({ id: "a1", title: "Cũ", archived_at: "2026-09-01T00:00:00Z" })]) });
    renderView();
    await openArchiveScope();
    await openMenu("Cũ");
    expect(await screen.findByRole("menuitem", { name: t("documents.home.row.open_web") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.restore") })).toBeNull();
  });

  it("restores through the dialog, toasts the returned title and drops the row from the Archive list", async () => {
    let restored = false;
    route({
      list: (path) => (restored ? [] : archivedList([archivedFolder()])(path)),
      post: (path) => {
        if (path !== "/api/v1/documents/f1/restore") return {};
        restored = true;
        return { document: archivedFolder({ title: "Dự án CCB (2)", archived_at: null }), batch_id: "b1", affected: ["f1"] };
      },
    });
    renderView();
    await openArchiveScope();
    await openMenu("Dự án CCB");
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.actions.restore") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.archive.restore_title"))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.archive.restore_confirm") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.folders.toast.restored", { title: "Dự án CCB (2)" })));
    expect(calls("POST").map(([path]) => path)).toContain("/api/v1/documents/f1/restore");
    await waitFor(() => expect(screen.queryByText("Dự án CCB")).toBeNull());
  });

  it("names the same actions the same way on a folder row and in the tree menu", async () => {
    route({ list: () => [summary({ id: "f1", kind: "folder", title: "Hợp đồng" })] });
    renderView();
    await openMenu("Hợp đồng");
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.tree.menu.delete") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.archive") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.move") })).toBeNull();
  });

  it("uses Move to… on a document row too and keeps Archive for it", async () => {
    route({ list: () => [summary()] });
    renderView();
    await openMenu("Kế hoạch Q4");
    expect(await screen.findByRole("menuitem", { name: t("documents.tree.menu.move_to") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.home.row.archive") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.home.row.move") })).toBeNull();
  });

  it("carries the same words in English: Move to… and Delete", () => {
    expect(enLocale.documents.tree.menu.move_to).toBe("Move to…");
    expect(enLocale.documents.tree.menu.delete).toBe("Delete");
    expect(enLocale.documents.actions.restore).toBe("Restore");
  });

  it("carries the same words in Vietnamese: Di chuyển tới… and Xóa", () => {
    const tree = viLocale.documents.tree.menu;
    expect(tree.move_to).toBe("Di chuyển tới…");
    expect(tree.delete).toBe("Xóa");
    expect(viLocale.documents.actions.restore).toBe("Khôi phục");
  });
});

describe("workspace access report entry (UNI-1643)", () => {
  it("the header overflow opens the workspace access report for any member", async () => {
    route({});
    const adapter = renderView();
    fireEvent.click(await screen.findByRole("button", { name: t("documents.actions.menu_label") }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.accessReport.menu_workspace") }));
    expect(adapter.push).toHaveBeenCalledWith("/acme/doi/documents/access-report");
  });
});
