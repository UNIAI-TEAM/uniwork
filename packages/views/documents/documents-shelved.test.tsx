import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import type { WSClient, WSMessage } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { useRealtimeSync } from "@uniwork/core/realtime";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// ARCHIVE-01 (UNI-1845) "Lưu trữ" list (U-1..U-5): its own nav row and
// library scope (GET .../documents?shelved=true), type chips to the server,
// the client-side "Lưu trữ bởi" member filter, per-row Bỏ lưu trữ behind the
// manage rule with a one-request guard, and the realtime wave that drops a
// shelved row from the regular lists. The transport is mocked, so the real
// response schemas stay in the loop.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

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

/** The labelled action a sonner toast option carries (the shelve undo). */
interface ToastAction {
  label: string;
  onClick?: () => void;
}

function shelved(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    my_level: "manage",
    visibility: "workspace",
    updated_at: "2026-09-28T03:00:00Z",
    shelved_at: "2026-10-10T03:00:00Z",
    shelved_by: "u2",
    parent_id: null,
    ...over,
  };
}

function live(over: Record<string, unknown> = {}) {
  return shelved({ ...over, shelved_at: undefined, shelved_by: undefined });
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

interface Routes {
  list?: (path: string) => unknown[];
  members?: () => unknown[];
  post?: (path: string) => unknown;
  impact?: (path: string) => unknown;
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
    if (path.endsWith("/archive-impact")) return run(() => routes.impact?.(path) ?? {});
    if (path.startsWith(`${LIST_BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(`${LIST_BASE}/sources`)) return run(() => ({ items: [], next_cursor: null }));
    if (path.startsWith(`${LIST_BASE}/recent`)) return run(() => ({ documents: [], next_cursor: null }));
    if (path.startsWith(`${LIST_BASE}/shared-with-me`)) return run(() => ({ documents: [], next_cursor: null }));
    if (method === "POST") return run(() => routes.post?.(path) ?? {});
    if (path.startsWith(LIST_BASE)) return run(() => ({ documents: routes.list?.(path) ?? [], next_cursor: null }));
    return Promise.resolve({});
  });
}

function nav(initialSearch = ""): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(initialSearch),
    getShareableUrl: (p) => p,
  };
}

function renderView(adapter: NavigationAdapter = nav(), onOpen: (id: string) => void = vi.fn(), client?: QueryClient) {
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
      client,
    ),
  );
  return adapter;
}

async function openShelved() {
  fireEvent.click(await screen.findByRole("tab", { name: new RegExp(t("documents.home.scope.shelved")) }));
}

async function rowOf(title: string) {
  const cell = (await screen.findAllByText(title)).find((el) => el.closest("tr"));
  const row = cell?.closest("tr");
  if (!row) throw new Error(`no row for ${title}`);
  return row as HTMLElement;
}

const query = (path: string) => new URLSearchParams(path.split("?")[1] ?? "");

const shelvedRequests = () =>
  requestMock.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith(LIST_BASE) && query(path).get("shelved") === "true");

const postsTo = (suffix: string) =>
  requestMock.mock.calls.filter(
    ([path, opts]) => String(path).endsWith(suffix) && (opts as { method?: string } | undefined)?.method === "POST",
  );

/** A WSClient stand-in the realtime sync can subscribe to; emit() pushes a frame. */
interface FakeWSClient extends WSClient {
  emit(msg: WSMessage): void;
}

function fakeClient(): FakeWSClient {
  const anyHandlers = new Set<(msg: WSMessage) => void>();
  const reconnectHandlers = new Set<() => void>();
  const client = {
    onAny: (h: (msg: WSMessage) => void) => {
      anyHandlers.add(h);
      return () => anyHandlers.delete(h);
    },
    onReconnect: (h: () => void) => {
      reconnectHandlers.add(h);
      return () => reconnectHandlers.delete(h);
    },
    emit: (msg: WSMessage) => anyHandlers.forEach((h) => h(msg)),
    reconnect: () => reconnectHandlers.forEach((h) => h()),
  };
  return client as unknown as FakeWSClient;
}

function RealtimeProbe({ client }: { client: FakeWSClient }) {
  useRealtimeSync(client, WS);
  return null;
}

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
});

// UI-AR1
describe("shelved nav + list", () => {
  it("lists the nav item, opens ?view=shelved and asks the server for shelved=true", async () => {
    route({ list: () => [shelved()] });
    const adapter = renderView();
    await openShelved();

    expect(vi.mocked(adapter.push)).toHaveBeenCalledWith(expect.stringContaining("view=shelved"));
    expect(await screen.findByRole("heading", { level: 2, name: t("documents.shelved_list.title") })).toBeInTheDocument();
    await waitFor(() => expect(shelvedRequests().length).toBeGreaterThan(0));
    expect(shelvedRequests().every((path) => query(path).get("archived") === null)).toBe(true);
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("names the member who shelved the row, the access and the shelved stamp", async () => {
    route({
      list: () => [
        shelved(),
        shelved({ id: "d2", title: "Tài liệu cũ", shelved_by: "u9", visibility: "restricted" }),
        shelved({ id: "d3", title: "Tự động", shelved_by: null }),
      ],
      members: () => [member()],
    });
    renderView();
    await openShelved();

    const first = await rowOf("Kế hoạch Q4");
    expect(within(first).getAllByText("Mai Trường").length).toBeGreaterThan(0);
    const second = await rowOf("Tài liệu cũ");
    expect(within(second).getAllByText(t("documents.shelved_list.shelved_by_former")).length).toBeGreaterThan(0);
    const third = await rowOf("Tự động");
    expect(within(third).getAllByText(t("documents.shelved_list.shelved_by_system")).length).toBeGreaterThan(0);
  });

  it("sends the type chip as format= and re-fetches", async () => {
    route({ list: () => [shelved()] });
    renderView();
    await openShelved();
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("button", { name: t("documents.home.chips.docx") }));
    await waitFor(() =>
      expect(shelvedRequests().some((path) => query(path).get("format") === "docx")).toBe(true),
    );
    expect(shelvedRequests().every((path) => query(path).get("shelved") === "true")).toBe(true);
  });

  it("filters 'Lưu trữ bởi' client-side and says it covers only what is loaded", async () => {
    route({
      list: () => [shelved(), shelved({ id: "d2", title: "Bởi người khác", shelved_by: "u3" })],
      members: () => [member(), member({ user_id: "u3", display_name: "Đạt Đặng" })],
    });
    renderView();
    await openShelved();
    await rowOf("Bởi người khác");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: t("documents.shelved_list.filter_by_label") }));
    const option = await screen.findByRole("option", { name: "Mai Trường" });
    // Base UI's select commits on a pointer press, not on a bare click.
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.click(option);

    await waitFor(() => expect(screen.queryByText("Bởi người khác")).toBeNull());
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.getByText(t("documents.shelved_list.filter_loaded_only"))).toBeInTheDocument();
  });

  it("opens the document when a row is clicked", async () => {
    route({ list: () => [shelved()] });
    const onOpen = vi.fn();
    renderView(nav(), onOpen);
    await openShelved();
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getAllByRole("button", { name: /Kế hoạch Q4/ })[0]!);
    expect(onOpen).toHaveBeenCalledWith("d1");
  });

  it("shows the empty copy and never a fake row", async () => {
    route({ list: () => [] });
    renderView();
    await openShelved();
    expect(await screen.findByText(t("documents.shelved_list.empty_title"))).toBeInTheDocument();
    expect(screen.getByText(t("documents.shelved_list.empty_description"))).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Kế hoạch/ })).toBeNull();
  });

  it("reports a failed list through the shared error state and retries", async () => {
    let calls = 0;
    route({
      list: (path) => {
        if (query(path).get("shelved") !== "true") return [];
        calls += 1;
        if (calls === 1) throw new ApiError("boom", "internal", 500);
        return [shelved()];
      },
    });
    renderView();
    await openShelved();
    const retry = await screen.findByRole("button", { name: t("documents.library.retry") });
    fireEvent.click(retry);
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });
});

// UI-AR2
describe("unshelve row action", () => {
  it("offers Bỏ lưu trữ with the item's name to a manager and to admin_scope, not to an editor", async () => {
    route({
      list: () => [
        shelved(),
        shelved({ id: "d2", title: "Hồ sơ hạn chế", my_level: undefined, admin_scope: true }),
        shelved({ id: "d3", title: "Chỉ sửa", my_level: "edit" }),
      ],
    });
    renderView();
    await openShelved();

    expect(
      within(await rowOf("Kế hoạch Q4")).getByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Kế hoạch Q4" }),
      }),
    ).toBeInTheDocument();
    expect(
      within(await rowOf("Hồ sơ hạn chế")).getByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Hồ sơ hạn chế" }),
      }),
    ).toBeInTheDocument();
    expect(
      within(await rowOf("Chỉ sửa")).queryByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Chỉ sửa" }),
      }),
    ).toBeNull();
  });

  it("unshelves through POST /unshelve, toasts and drops the row", async () => {
    let done = false;
    route({
      list: (path) => (query(path).get("shelved") === "true" ? (done ? [] : [shelved()]) : []),
      post: (path) => {
        if (path !== "/api/v1/documents/d1/unshelve") return {};
        done = true;
        return { document: shelved({ shelved_at: null, shelved_by: null }), affected: ["d1"] };
      },
    });
    renderView();
    await openShelved();
    fireEvent.click(
      within(await rowOf("Kế hoạch Q4")).getByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Kế hoạch Q4" }),
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.shelved_list.toast.unshelved", { title: "Kế hoạch Q4" })),
    );
    expect(postsTo("/unshelve").map(([path]) => path)).toEqual(["/api/v1/documents/d1/unshelve"]);
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
  });

  it("sends one unshelve on a double click", async () => {
    // A manual deferred: TS here predates Promise.withResolvers (es2024).
    let release!: (value: unknown) => void;
    const gate = {
      promise: new Promise<unknown>((res) => {
        release = res;
      }),
      resolve: (value: unknown) => release(value),
    };
    route({
      list: (path) => (query(path).get("shelved") === "true" ? [shelved()] : []),
      post: (path) => (path === "/api/v1/documents/d1/unshelve" ? gate.promise : {}),
    });
    renderView();
    await openShelved();
    const button = within(await rowOf("Kế hoạch Q4")).getByRole("button", {
      name: t("documents.shelved_list.unshelve_item", { title: "Kế hoạch Q4" }),
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(postsTo("/unshelve")).toHaveLength(1);
    gate.resolve({ document: shelved({ shelved_at: null }), affected: ["d1"] });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says honestly when unshelving a folder leaves shelved descendants behind", async () => {
    route({
      list: (path) =>
        query(path).get("shelved") === "true"
          ? [
              shelved({ id: "f1", kind: "folder", title: "Dự án cũ" }),
              shelved({ id: "c1", title: "Bản nháp", parent_id: "f1", my_level: "edit" }),
            ]
          : [],
      post: (path) => {
        if (path !== "/api/v1/documents/f1/unshelve") return {};
        return { document: shelved({ id: "f1", kind: "folder", title: "Dự án cũ", shelved_at: null }), affected: ["f1"] };
      },
    });
    renderView();
    await openShelved();
    fireEvent.click(
      within(await rowOf("Dự án cũ")).getByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Dự án cũ" }),
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("documents.shelved_list.toast.unshelved", { title: "Dự án cũ" }), {
        description: t("documents.shelved_list.toast.left_shelved"),
      }),
    );
  });

  it("maps a 403 to the no-permission copy and a generic failure to the fallback", async () => {
    route({
      list: (path) =>
        query(path).get("shelved") === "true"
          ? [shelved({ id: "e1", title: "Cấm sửa" }), shelved({ id: "e2", title: "Lỗi lạ" })]
          : [],
      post: (path) => {
        if (path === "/api/v1/documents/e1/unshelve") throw new ApiError("forbidden", "forbidden", 403);
        if (path === "/api/v1/documents/e2/unshelve") throw new ApiError("", "weird_failure", 500);
        return {};
      },
    });
    renderView();
    await openShelved();
    fireEvent.click(
      within(await rowOf("Cấm sửa")).getByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Cấm sửa" }),
      }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.shelved_list.no_permission")));
    fireEvent.click(
      within(await rowOf("Lỗi lạ")).getByRole("button", {
        name: t("documents.shelved_list.unshelve_item", { title: "Lỗi lạ" }),
      }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.shelved_list.unshelve_failed")));
  });
});

// UI-AR9
describe("realtime shelved frame", () => {
  it("drops the row from the home list when document.shelved lands", async () => {
    let dropped = false;
    route({
      list: (path) => {
        const q = query(path);
        if (q.get("shelved") === "true" || q.get("archived") === "1") return [];
        return dropped ? [] : [live()];
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
    const client = fakeClient();
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    render(
      wrap(
        <>
          <RealtimeProbe client={client} />
          <NavigationProvider value={nav()}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <FeatureFlagsProvider service={service}>
                <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
              </FeatureFlagsProvider>
            </WorkspaceProvider>
          </NavigationProvider>
        </>,
        qc,
      ),
    );

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    // The frame says the server already shelved it: the next read of the list
    // (the invalidation's GET, not a POST) answers without the row.
    act(() => {
      dropped = true;
      client.emit({ type: "document.shelved", payload: { document_id: "d1", workspace_id: WS } } as WSMessage);
    });
    // The scheduler debounces the wave (~250ms); give it real time to run.
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
  });
});

// U-3/U-4 — the "Lưu trữ" entry on a live row's menu.
describe("shelve from a live row's menu (U-4)", () => {
  it("offers Lưu trữ to a manager on the home list and shelves the item at once", async () => {
    let shelvedNow = false;
    route({
      list: (path) => {
        const q = query(path);
        if (q.get("shelved") === "true" || q.get("archived") === "1") return [];
        return shelvedNow ? [] : [live()];
      },
      post: (path) => {
        if (path !== "/api/v1/documents/d1/shelve") return {};
        shelvedNow = true;
        return { document: shelved(), affected: ["d1"] };
      },
    });
    renderView();
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.shelved_list.shelve") }));

    await waitFor(() => expect(postsTo("/shelve").map(([path]) => path)).toEqual(["/api/v1/documents/d1/shelve"]));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        t("documents.shelved_list.toast.shelved", { title: "Kế hoạch Q4" }),
        expect.objectContaining({ action: expect.objectContaining({ label: t("documents.shelved_list.undo") }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("Kế hoạch Q4")).toBeNull());
  });
  it("sends unshelve when the toast's Hoàn tác is picked", async () => {
    route({
      list: (path) => (query(path).get("shelved") === "true" ? [] : [live()]),
      post: () => ({ document: shelved(), affected: ["d1"] }),
    });
    renderView();
    const row = await rowOf("Kế hoạch Q4");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.shelved_list.shelve") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // ExternalToast.action's runtime shape is our ToastAction; the click is the undo.
    const action = toast.success.mock.calls.at(-1)?.[1]?.action as ToastAction | undefined;
    action?.onClick?.();
    await waitFor(() => expect(postsTo("/unshelve").map(([path]) => path)).toEqual(["/api/v1/documents/d1/unshelve"]));
  });

  it("opens the confirm dialog for a folder with the counts the server read", async () => {
    route({
      list: (path) => (query(path).get("shelved") === "true" ? [] : [live({ id: "f1", kind: "folder", title: "Hợp đồng" })]),
      impact: (path) =>
        path === "/api/v1/documents/f1/archive-impact"
          ? { folders: 2, documents: 3, total: 6, max_nodes: 1000, too_large: false }
          : {},
    });
    renderView();
    const row = await rowOf("Hợp đồng");
    fireEvent.click(within(row).getByRole("button", { name: t("documents.home.row.menu", { title: "Hợp đồng" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.shelved_list.shelve") }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(t("documents.shelved_list.shelve_title"))).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        t("documents.shelved_list.shelve_folder_body", {
          subfolders: t("documents.shelved_list.shelve_subfolders", { count: 2 }),
          documents: t("documents.shelved_list.shelve_documents", { count: 3 }),
        }),
      ),
    ).toBeInTheDocument();
  });

  it("never shows Lưu trữ to an editor or on the system My Folder row", async () => {
    route({
      list: (path) =>
        query(path).get("shelved") === "true"
          ? []
          : [
              live({ id: "d2", title: "Chỉ sửa", my_level: "edit" }),
              live({ id: "mf", kind: "folder", title: "Thư mục của tôi", system_kind: "my_folder" }),
            ],
    });
    renderView();
    const editRow = await rowOf("Chỉ sửa");
    fireEvent.click(within(editRow).getByRole("button", { name: t("documents.home.row.menu", { title: "Chỉ sửa" }) }));
    expect(screen.queryByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    const myFolder = await rowOf("Thư mục của tôi");
    const menu = within(myFolder).queryByRole("button", { name: t("documents.home.row.menu", { title: "Thư mục của tôi" }) });
    if (menu) {
      fireEvent.click(menu);
      expect(screen.queryByRole("menuitem", { name: t("documents.shelved_list.shelve") })).toBeNull();
    }
  });
});
