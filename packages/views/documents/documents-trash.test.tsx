import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// RESTORE-01 (UNI-1843) trash view: per-item restore, permanent delete behind
// a confirm dialog, read-only rows for edit-only holders, the 30-day countdown
// and the Xóa bởi column fed by the members list. The transport is mocked, so
// the real response schemas stay in the loop.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
  };
});

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const MEMBERS_URL = `/api/v1/workspaces/${WS}/members`;
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function trashed(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    my_level: "manage",
    updated_at: "2026-09-28T03:00:00Z",
    archived_at: "2026-10-10T03:00:00Z",
    archived_by: "u2",
    parent_id: null,
    ...over,
  };
}

function member(over: Record<string, unknown> = {}) {
  return {
    workspace_id: WS,
    user_id: "u2",
    role: "member",
    email: "truong@example.com",
    display_name: "Mai Trường",
    ...over,
  };
}

/** A purge_after `days` calendar days ahead of now (noon-based, so the clock edge cannot shift it). */
function purgeInDays(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

interface Routes {
  list?: (path: string) => unknown[];
  /** next_cursor of a list page; null (the default) is the last page. */
  cursor?: (path: string) => string | null;
  members?: () => unknown[];
  post?: (path: string) => unknown;
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
    if (path === MEMBERS_URL) return run(() => ({ members: routes.members?.() ?? [] }));
    if (path.includes("/documents/favorites")) return run(() => ({ favorites: [] }));
    if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(`${LIST_BASE}/sources`)) return run(() => ({ items: [], next_cursor: null }));
    if (path.startsWith(`${LIST_BASE}/recent`)) return run(() => ({ documents: [], next_cursor: null }));
    if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return run(() => ({ documents: [], next_cursor: null }));
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (path.startsWith(LIST_BASE)) return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: routes.cursor?.(path) ?? null }));
    return Promise.resolve({});
  });
}

function nav(search = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function renderView(adapter: NavigationAdapter = nav(), onOpen: (id: string) => void = vi.fn()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={adapter}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={onOpen} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  return adapter;
}

async function openTrash() {
  // The trash lives on the sidebar, not a view tab (TRASH-01 layout).
  const scope = await screen.findAllByRole("button", { name: new RegExp(t("documents.home.sidebar.trash")) });
  fireEvent.click(scope[0]!);
}

async function rowOf(title: string) {
  const cell = (await screen.findAllByText(title)).find((el) => el.closest("tr"));
  const row = cell?.closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

const postsTo = (suffix: string) =>
  requestMock.mock.calls.filter(
    ([path, opts]) => String(path).endsWith(suffix) && (opts as { method?: string } | undefined)?.method === "POST",
  );

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
});

describe("trash list", () => {
  it("names itself Thùng rác, explains the 30-day rule and shows the trash columns", async () => {
    route({ list: () => [trashed()] });
    renderView();
    await openTrash();
    expect(await screen.findByRole("heading", { level: 1, name: t("documents.trash.title") })).toBeInTheDocument();
    expect(screen.getByText(t("documents.trash.subtitle"))).toBeInTheDocument();
    expect(await screen.findByText(t("documents.trash.note"), { exact: false })).toBeInTheDocument();
    for (const key of ["name", "deleted_by", "deleted_at", "purge_in"] as const) {
      expect(screen.getByText(t(`documents.trash.columns.${key}`))).toBeInTheDocument();
    }
    expect(screen.getByText(t("documents.trash.columns.actions"))).toBeInTheDocument();
  });

  it("offers Khôi phục and Xóa vĩnh viễn on a row the viewer manages", async () => {
    route({ list: () => [trashed()] });
    renderView();
    await openTrash();
    const row = await rowOf("Kế hoạch Q4");
    expect(within(row).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t("documents.trash.purge_item", { title: "Kế hoạch Q4" }) })).toBeInTheDocument();
    expect(within(row).queryByText(t("documents.trash.read_only"))).toBeNull();
  });

  it("keeps Khôi phục and Xóa vĩnh viễn on a restricted row a workspace admin sees (no my_level, admin_scope)", async () => {
    route({ list: () => [trashed({ my_level: undefined, admin_scope: true, title: "Hồ sơ hạn chế" })] });
    renderView();
    await openTrash();
    const row = await rowOf("Hồ sơ hạn chế");
    expect(within(row).getByRole("button", { name: t("documents.trash.restore_item", { title: "Hồ sơ hạn chế" }) })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: t("documents.trash.purge_item", { title: "Hồ sơ hạn chế" }) })).toBeInTheDocument();
    expect(within(row).queryByText(t("documents.trash.read_only"))).toBeNull();
  });

  it("shows the read-only label and no actions on a row the viewer only edits, and its name does not open", async () => {
    route({ list: () => [trashed({ my_level: "edit", kind: "file", title: "Slide kick-off.pptx" })] });
    const onOpen = vi.fn();
    const adapter = renderView(nav(), onOpen);
    await openTrash();
    vi.mocked(adapter.push).mockClear();
    const row = await rowOf("Slide kick-off.pptx");
    // jsdom ignores the container ladder: the name cell's wrapped line and the actions cell both carry the label.
    expect(within(row).getAllByText(t("documents.trash.read_only")).length).toBeGreaterThan(0);
    expect(within(row).queryByRole("button", { name: t("documents.trash.restore_item", { title: "Slide kick-off.pptx" }) })).toBeNull();
    expect(within(row).queryByRole("button", { name: t("documents.trash.purge_item", { title: "Slide kick-off.pptx" }) })).toBeNull();
    // The name is inert text, not a button (T-3: content stays manage-only).
    expect(within(row).queryByRole("button", { name: /Slide kick-off/ })).toBeNull();
    fireEvent.click(within(row).getByText("Slide kick-off.pptx"));
    expect(onOpen).not.toHaveBeenCalled();
    expect(adapter.push).not.toHaveBeenCalled();
  });

  it("names the member who deleted the row and falls back for a former member", async () => {
    route({
      list: () => [trashed(), trashed({ id: "d2", title: "Tài liệu cũ", archived_by: "u9" })],
      members: () => [member()],
    });
    renderView();
    await openTrash();
    const first = await rowOf("Kế hoạch Q4");
    // jsdom does not evaluate the container-query ladder: the name cell's meta
    // line and the Xóa bởi column both carry the name.
    expect(within(first).getAllByText("Mai Trường").length).toBeGreaterThan(0);
    const second = await rowOf("Tài liệu cũ");
    expect(within(second).getAllByText(t("documents.trash.deleted_by_unknown")).length).toBeGreaterThan(0);
  });

  it("counts the purge deadline down in days, names today, and marks an expired row", async () => {
    route({
      list: () => [
        trashed({ id: "n12", title: "Mười hai ngày", purge_after: purgeInDays(12) }),
        trashed({ id: "n0", title: "Hết hạn hôm nay", purge_after: purgeInDays(0) }),
        trashed({ id: "nx", title: "Quá hạn", purge_after: purgeInDays(-3) }),
      ],
    });
    renderView();
    await openTrash();
    expect(within(await rowOf("Mười hai ngày")).getByText(t("documents.trash.purge_days", { count: 12 }))).toBeInTheDocument();
    expect(within(await rowOf("Hết hạn hôm nay")).getByText(t("documents.trash.purge_today"))).toBeInTheDocument();
    expect(within(await rowOf("Quá hạn")).getByText(t("documents.trash.purge_expired"))).toBeInTheDocument();
  });
});

describe("deleted-at stamp", () => {
  it("shows the clock for today and a short day-month for another day, never a two-part date-time", async () => {
    const now = new Date();
    const earlier = new Date(now);
    earlier.setDate(earlier.getDate() - 3);
    earlier.setHours(12, 0, 0, 0);
    const today = new Date(now);
    today.setHours(0, 5, 0, 0);
    route({
      list: () => [
        trashed({ id: "t1", title: "Xóa hôm nay", archived_at: today.toISOString() }),
        trashed({ id: "t2", title: "Xóa hôm trước", archived_at: earlier.toISOString() }),
      ],
    });
    renderView();
    await openTrash();
    const clock = new Intl.DateTimeFormat("vi", { hour: "2-digit", minute: "2-digit" }).format(today);
    expect(within(await rowOf("Xóa hôm nay")).getAllByText(new RegExp(`^${clock}`)).length).toBeGreaterThan(0);
    const other = within(await rowOf("Xóa hôm trước")).getAllByText(/^\d{2}\/\d{2}(\/\d{4})?(?: ·.*)?$/);
    expect(other.length).toBeGreaterThan(0);
    expect(other.some((el) => /\d{2}:\d{2}/.test(el.textContent ?? ""))).toBe(false);
  });
});

describe("trash row edge cases", () => {
  it("renders a dash, never NaN, for a missing or an invalid purge_after", async () => {
    route({
      list: () => [
        trashed({ id: "m1", title: "Không hạn", purge_after: null }),
        trashed({ id: "m2", title: "Hạn lỗi", purge_after: "not-a-date" }),
      ],
      members: () => [member()],
    });
    renderView();
    await openTrash();
    for (const title of ["Không hạn", "Hạn lỗi"]) {
      const row = await rowOf(title);
      // Deleter and deleted-at are present, so the one dash is the countdown cell.
      expect(within(row).getAllByText("—")).toHaveLength(1);
      expect(row).not.toHaveTextContent("NaN");
    }
  });

  it("renders a dash for the deleter of a system or null archived_by", async () => {
    route({
      list: () => [trashed({ id: "s1", title: "Do hệ thống", archived_by: null, purge_after: purgeInDays(5) })],
      members: () => [member()],
    });
    renderView();
    await openTrash();
    const row = await rowOf("Do hệ thống");
    expect(within(row).getAllByText("—")).toHaveLength(1);
    expect(within(row).queryByText(t("documents.trash.deleted_by_unknown"))).toBeNull();
  });
});

describe("restore", () => {
  it("restores the row through POST /restore, toasts the workspace-root destination and drops the row", async () => {
    let restored = false;
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? (restored ? [] : [trashed()]) : [],
      post: (path) => {
        if (path !== "/api/v1/documents/d1/restore") return {};
        restored = true;
        return { document: trashed({ archived_at: null, purge_after: null, parent_id: null }), batch_id: "b1", affected: ["d1"] };
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.trash.toast.restored_root", { title: "Kế hoạch Q4" })));
    expect(postsTo("/restore").map(([path]) => path)).toEqual(["/api/v1/documents/d1/restore"]);
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
  });

  it("sends one restore on a double click, disables the row's button while it runs and shows no error toast", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    route({
      list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [trashed()] : []),
      post: (path) => (path === "/api/v1/documents/d1/restore" ? gate : {}),
    });
    renderView();
    await openTrash();
    const button = within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(postsTo("/restore")).toHaveLength(1);
    release({ document: trashed({ archived_at: null, purge_after: null, parent_id: null }), batch_id: "b1", affected: ["d1"] });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(postsTo("/restore")).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts the folder name when the item lands back in its old folder", async () => {
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [trashed()] : [],
      post: (path) => {
        if (path !== "/api/v1/documents/d1/restore") return {};
        return {
          document: trashed({
            archived_at: null,
            purge_after: null,
            parent_id: "f9",
            breadcrumbs: [
              { id: "f9", title: "Hợp đồng" },
              { id: "d1", title: "Kế hoạch Q4" },
            ],
          }),
          batch_id: "b1",
          affected: ["d1"],
        };
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.trash.toast.restored_folder", { title: "Kế hoạch Q4", folder: "Hợp đồng" })),
    );
  });

  it("says honestly when a folder restore leaves children it cannot manage in the trash", async () => {
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1"
          ? [
              trashed({ id: "f1", kind: "folder", title: "Dự án cũ" }),
              trashed({ id: "c1", title: "Bản nháp", parent_id: "f1", my_level: "edit" }),
            ]
          : [],
      post: (path) => {
        if (path !== "/api/v1/documents/f1/restore") return {};
        return { document: trashed({ id: "f1", kind: "folder", title: "Dự án cũ", archived_at: null, parent_id: null }), batch_id: "b1", affected: ["f1"] };
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Dự án cũ")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Dự án cũ" }) }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.trash.toast.restored_root", { title: "Dự án cũ" }), {
        description: t("documents.trash.toast.left_in_trash"),
      }),
    );
  });

  it("maps a not-in-trash refusal and a 403 to clear copy", async () => {
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1"
          ? [trashed({ id: "e1", title: "Đã về" }), trashed({ id: "e2", title: "Cấm sửa" })]
          : [],
      post: (path) => {
        if (path === "/api/v1/documents/e1/restore") throw new ApiError("không trong thùng rác", "document_not_in_trash", 400);
        if (path === "/api/v1/documents/e2/restore") throw new ApiError("forbidden", "forbidden", 403);
        return {};
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Đã về")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Đã về" }) }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.trash.not_in_trash")));
    fireEvent.click(within(await rowOf("Cấm sửa")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Cấm sửa" }) }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.trash.no_permission")));
  });
});

describe("stale rows", () => {
  it("rereads the list when a restore answers not-in-trash, so the stale row leaves", async () => {
    let gone = false;
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? (gone ? [] : [trashed({ id: "e1", title: "Đã về" })]) : [],
      post: () => {
        gone = true;
        throw new ApiError("không trong thùng rác", "document_not_in_trash", 400);
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Đã về")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Đã về" }) }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.trash.not_in_trash")));
    await waitFor(() => expect(screen.queryByText("Đã về")).toBeNull());
  });

  it("closes the purge dialog, toasts and rereads the list when a purge answers not-in-trash", async () => {
    let gone = false;
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? (gone ? [] : [trashed({ id: "e1", title: "Đã mất" })]) : [],
      post: () => {
        gone = true;
        throw new ApiError("không trong thùng rác", "document_not_in_trash", 400);
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Đã mất")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Đã mất" }) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.trash.purge") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(toast.error).toHaveBeenCalledWith(t("documents.trash.not_in_trash"));
    await waitFor(() => expect(screen.queryByText("Đã mất")).toBeNull());
  });
});

describe("restore failures", () => {
  it("falls back to the generic copy on an unknown restore error", async () => {
    route({
      list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [trashed()] : []),
      post: () => {
        throw new ApiError("", "weird_failure", 500);
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.trash.restore_failed")));
  });
});

describe("permanent delete", () => {
  it("opens a destructive confirm that names the item; cancel sends nothing, confirm purges and the row leaves", async () => {
    let purged = false;
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? (purged ? [] : [trashed()]) : [],
      post: (path) => {
        if (path !== "/api/v1/documents/d1/purge") return {};
        purged = true;
        return {};
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Kế hoạch Q4" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.trash.purge_title", { title: "Kế hoạch Q4" }))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(postsTo("/purge")).toHaveLength(0);

    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Kế hoạch Q4" }) }));
    const again = await screen.findByRole("alertdialog");
    fireEvent.click(within(again).getByRole("button", { name: t("documents.trash.purge") }));
    await waitFor(() => expect(postsTo("/purge").map(([path]) => path)).toEqual(["/api/v1/documents/d1/purge"]));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith(t("documents.trash.purged", { title: "Kế hoạch Q4" }));
  });

  it("warns on a folder that children the viewer does not manage stay in the trash", async () => {
    route({ list: () => [trashed({ kind: "folder", title: "Dự án cũ" })] });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Dự án cũ")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Dự án cũ" }) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.trash.purge_folder_description"))).toBeInTheDocument();
  });

  it("keeps the dialog open with clear copy on folder_too_large and on 403", async () => {
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1"
          ? [trashed({ id: "e1", kind: "folder", title: "Thư mục lớn" }), trashed({ id: "e2", title: "Cấm xóa" })]
          : [],
      post: (path) => {
        if (path === "/api/v1/documents/e1/purge") throw new ApiError("quá lớn", "folder_too_large", 400);
        if (path === "/api/v1/documents/e2/purge") throw new ApiError("forbidden", "forbidden", 403);
        return {};
      },
    });
    renderView();
    await openTrash();

    fireEvent.click(within(await rowOf("Thư mục lớn")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Thư mục lớn" }) }));
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.trash.purge") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.trash.too_large"));
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(within(await rowOf("Cấm xóa")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Cấm xóa" }) }));
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.trash.purge") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.trash.no_permission"));
  });

  it("sends one purge on a double submit", async () => {
    let release: (value: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    route({
      list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [trashed()] : []),
      post: (path) => (path === "/api/v1/documents/d1/purge" ? gate : {}),
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Kế hoạch Q4" }) }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: t("documents.trash.purge") });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(postsTo("/purge")).toHaveLength(1);
    release({});
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(postsTo("/purge")).toHaveLength(1);
  });

  it("falls back to the generic copy on an unknown purge error and keeps the dialog open", async () => {
    route({
      list: (path) => (new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? [trashed()] : []),
      post: () => {
        throw new ApiError("", "weird_failure", 500);
      },
    });
    renderView();
    await openTrash();
    fireEvent.click(within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Kế hoạch Q4" }) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.trash.purge") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(t("documents.trash.purge_failed"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("leaves focus on a live node once the purge closes the dialog and the row is gone", async () => {
    let purged = false;
    route({
      list: (path) =>
        new URLSearchParams(path.split("?")[1] ?? "").get("archived") === "1" ? (purged ? [] : [trashed()]) : [],
      post: (path) => {
        if (path === "/api/v1/documents/d1/purge") purged = true;
        return {};
      },
    });
    renderView();
    await openTrash();
    const trigger = within(await rowOf("Kế hoạch Q4")).getByRole("button", { name: t("documents.trash.purge_item", { title: "Kế hoạch Q4" }) });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.trash.purge") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
    // The trigger left the DOM with its row: focus must not be parked on it.
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
    expect(document.activeElement && document.body.contains(document.activeElement)).toBe(true);
  });
});

// TRASH-NOTIFY-01 (UNI-1844, N-4): the trashed-by-other notification opens
// `?view=archived&focus=<id>`; the list scrolls to that row, highlights it and
// puts the keyboard on its Khôi phục. An id that is not in the list is ignored.
describe("focused trash row", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it("opens straight on the trash and highlights, scrolls to and focuses the Khôi phục of the focused row", async () => {
    route({ list: () => [trashed({ id: "d0", title: "Biên bản" }), trashed({ id: "d1" }), trashed({ id: "d2", title: "Hợp đồng" })] });
    renderView(nav("view=archived&focus=d1"));
    const row = await rowOf("Kế hoạch Q4");
    const restore = within(row).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) });
    await waitFor(() => expect(restore).toHaveFocus());
    expect(row).toHaveAttribute("data-focused", "true");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
    for (const title of ["Biên bản", "Hợp đồng"]) {
      expect(await rowOf(title)).not.toHaveAttribute("data-focused");
    }
  });

  it("highlights a focused row the viewer cannot manage without moving focus into a missing button", async () => {
    route({ list: () => [trashed({ id: "d1", my_level: "edit" })] });
    renderView(nav("view=archived&focus=d1"));
    const row = await rowOf("Kế hoạch Q4");
    await waitFor(() => expect(row).toHaveAttribute("data-focused", "true"));
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("shows the plain trash list for an id that is gone, without an error or a highlight", async () => {
    route({ list: () => [trashed({ id: "d2", title: "Hợp đồng" })] });
    renderView(nav("view=archived&focus=already-restored"));
    const row = await rowOf("Hợp đồng");
    expect(row).not.toHaveAttribute("data-focused");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores focus outside the trash", async () => {
    route({ list: () => [trashed()] });
    renderView(nav("focus=d1"));
    await screen.findByRole("tab", { name: new RegExp(t("documents.home.scope.archived")) });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector("[data-focused]")).toBeNull();
  });

  it("moves focus with a visible ring (focusVisible) so Khôi phục shows it", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    route({ list: () => [trashed({ id: "d1" })] });
    renderView(nav("view=archived&focus=d1"));
    await rowOf("Kế hoạch Q4");
    await waitFor(() => expect(focus).toHaveBeenCalledWith({ focusVisible: true }));
    focus.mockRestore();
  });

  it("marks the focused row apart from hover with a ring token", async () => {
    route({ list: () => [trashed({ id: "d1" })] });
    renderView(nav("view=archived&focus=d1"));
    const row = await rowOf("Kế hoạch Q4");
    await waitFor(() => expect(row).toHaveAttribute("data-focused", "true"));
    expect(row.className).toContain("ring-ring");
  });

  it("says the item may be further down while the list has more pages, and drops the line once the row loads", async () => {
    route({
      list: (path) => (path.includes("cursor=c2") ? [trashed({ id: "d9", title: "Hợp đồng" })] : [trashed({ id: "d1", title: "Biên bản" })]),
      cursor: (path) => (path.includes("cursor=c2") ? null : "c2"),
    });
    renderView(nav("view=archived&focus=d9"));
    await rowOf("Biên bản");
    expect(await screen.findByText(t("documents.trash.focus_further"))).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    const row = await rowOf("Hợp đồng");
    expect(row).toHaveAttribute("data-focused", "true");
    expect(screen.queryByText(t("documents.trash.focus_further"))).toBeNull();
  });

  it("keeps the further-down line in an always-present live region, empty when there is nothing to say", async () => {
    route({
      list: (path) => (path.includes("cursor=c2") ? [trashed({ id: "d9", title: "Hợp đồng" })] : [trashed({ id: "d1", title: "Biên bản" })]),
      cursor: (path) => (path.includes("cursor=c2") ? null : "c2"),
    });
    renderView(nav("view=archived&focus=d9"));
    await rowOf("Biên bản");
    const region = await screen.findByRole("status");
    expect(region).toHaveTextContent(t("documents.trash.focus_further"));
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));
    await rowOf("Hợp đồng");
    // The same node empties; it is not removed and re-inserted with its text.
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });

  it("scrolls to and highlights a row that first appears after Load more, and leaves the keyboard on Load more", async () => {
    // A third page exists, so the Load more button the keyboard sits on stays in the document.
    route({
      list: (path) => (path.includes("cursor=c2") ? [trashed({ id: "d9", title: "Hợp đồng" })] : [trashed({ id: "d1", title: "Biên bản" })]),
      cursor: (path) => (path.includes("cursor=c2") ? "c3" : "c2"),
    });
    renderView(nav("view=archived&focus=d9"));
    await rowOf("Biên bản");
    const more = screen.getByRole("button", { name: t("documents.library.load_more") });
    more.focus();
    fireEvent.click(more);
    const row = await rowOf("Hợp đồng");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
    expect(row).toHaveAttribute("data-focused", "true");
    expect(more).toHaveFocus();
  });

  it("shows no further-down line once the list is exhausted without the row", async () => {
    route({ list: () => [trashed({ id: "d2", title: "Hợp đồng" })] });
    renderView(nav("view=archived&focus=gone"));
    await rowOf("Hợp đồng");
    expect(screen.queryByText(t("documents.trash.focus_further"))).toBeNull();
  });

  it("applies the scroll and focus once per focus id: not again after a scope switch back or a manual Load more", async () => {
    route({
      list: (path) => (path.includes("cursor=c2") ? [trashed({ id: "d9", title: "Hợp đồng" })] : [trashed({ id: "d1" })]),
      cursor: (path) => (path.includes("cursor=c2") ? null : "c2"),
    });
    renderView(nav("view=archived&focus=d1"));
    const row = await rowOf("Kế hoạch Q4");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    const restore = within(row).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) });
    await waitFor(() => expect(restore).toHaveFocus());
    // A manual Load more must not pull focus back to the focused row.
    const more = screen.getByRole("button", { name: t("documents.library.load_more") });
    more.focus();
    fireEvent.click(more);
    await rowOf("Hợp đồng");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveFocus();
    // Leaving the trash and coming back remounts the rows: still no second jump.
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.home.scope.recent")) }));
    fireEvent.click(await screen.findByRole("tab", { name: new RegExp(t("documents.home.scope.archived")) }));
    const again = await rowOf("Kế hoạch Q4");
    expect(again).toHaveAttribute("data-focused", "true");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(within(again).getByRole("button", { name: t("documents.trash.restore_item", { title: "Kế hoạch Q4" }) })).not.toHaveFocus();
  });
});
