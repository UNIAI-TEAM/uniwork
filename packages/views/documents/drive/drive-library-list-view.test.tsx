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
import type { User, Workspace } from "@uniwork/core/types";
import {
  createFakeDrivePickerAdapter,
} from "../../integrations/drive-picker";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DocumentsPageView } from "../documents-page-view";
import { buildDocumentsViewUrl, viewFromSearchParams } from "../documents-view-url";
import { DriveLibraryListView } from "./drive-library-list-view";
import * as driveConnectionsModule from "./use-drive-library-connections";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const WS = "ws1";
const CONFIG_URL = "/api/v1/config";
const DRIVE_CONNECTIONS_URL = `/api/v1/workspaces/${WS}/drive-connections`;
const DRIVE_LIST_URL = `/api/v1/workspaces/${WS}/drive-files`;
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

const sessionUser = {
  id: "u1",
  email: "minh@example.com",
  display_name: "Minh",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
} as User;

const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const connections: DriveConnectionSummary[] = [
  { id: "conn1", google_email: "uni-work1@gmail.com", needs_reconnect: false, linked_file_count: 3 },
  { id: "conn2", google_email: "uni-work2@gmail.com", needs_reconnect: false, linked_file_count: 2 },
  { id: "conn3", google_email: "uni-work3@gmail.com", needs_reconnect: true, linked_file_count: 1 },
];

function driveFile(over: Record<string, unknown> = {}) {
  return {
    id: "df1",
    organization_id: "org1",
    workspace_id: WS,
    external_file_id: "ext-1",
    name: "Kế hoạch ra mắt Q4",
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    web_view_link: "https://docs.google.com/document/d/ext-1/edit",
    open_url: "https://docs.google.com/document/d/ext-1/edit?authuser=uni-work1%40gmail.com",
    owner_display: "Lan",
    sharing_state: "private",
    connection_id: "conn1",
    bound_account_email: "uni-work1@gmail.com",
    bound_connection_lost: false,
    bound_by_id: "u1",
    bound_by_name: "Minh Nguyễn",
    created_by: "u1",
    created_by_kind: "human",
    created_by_name: "Minh Nguyễn",
    created_at: "2026-10-26T08:15:00Z",
    updated_at: "2026-10-26T08:15:00Z",
    viewer_access: "granted",
    viewer_connection_id: "conn1",
    viewer_account_email: "uni-work1@gmail.com",
    can_unlink: true,
    can_rebind: true,
    can_propose: true,
    can_ask: true,
    used_in_count: 5,
    used_in_tasks: [
      {
        task_id: "t1",
        identifier: "UNI-1042",
        title: "Chuẩn bị kế hoạch ra mắt Q4",
        status: "todo",
      },
    ],
    tasks_created: {
      count: 4,
      last_created_at: "2026-10-26T09:58:00Z",
      last_created_by_name: "Minh Nguyễn",
    },
    ...over,
  };
}

function withFlag(
  ui: React.ReactElement,
  on = true,
  nav = fakeNav(),
  driveFlag = true,
) {
  const service = new FeatureFlagService(
    new StaticProvider({
      documents: { default: on },
      drive_connector: { default: driveFlag },
    }),
  );
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={sessionUser}>
      <FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>
    </WorkspaceProvider>,
    nav,
  );
}

function defaultConfigResponse(driveAvailable = true, documentsFlag = true, driveFlag = true) {
  return {
    flags: { documents: documentsFlag, drive_connector: driveFlag },
    rum_sample_rate: 0,
    drive: { available: driveAvailable },
  };
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === CONFIG_URL) {
      return Promise.resolve(defaultConfigResponse(true));
    }
    if (path === DRIVE_CONNECTIONS_URL) {
      return Promise.resolve({ connections: [] });
    }
    return Promise.resolve({});
  });
  resetAuthStoreForTests();
  setSessionUser(sessionUser);
});
describe("documents-view-url drive view", () => {
  it("reads and builds ?view=drive and ?view=drive&account=<id>", () => {
    expect(viewFromSearchParams(new URLSearchParams("view=drive"))).toEqual({
      kind: "drive",
      account: null,
    });
    expect(viewFromSearchParams(new URLSearchParams("view=drive&account=conn1"))).toEqual({
      kind: "drive",
      account: "conn1",
    });

    const wsPaths = {
      documents: () => "/acme/doi/documents",
      documentsFolder: (id: string) => `/acme/doi/documents?folder=${id}`,
      documentsDrive: (account?: string | null) =>
        account ? `/acme/doi/documents?view=drive&account=${account}` : "/acme/doi/documents?view=drive",
    };

    expect(buildDocumentsViewUrl(wsPaths, { kind: "drive", account: null }, null)).toBe(
      "/acme/doi/documents?view=drive",
    );
    expect(buildDocumentsViewUrl(wsPaths, { kind: "drive", account: "conn1" }, "fo1")).toBe(
      "/acme/doi/documents?view=drive&account=conn1",
    );
  });
});

describe("DocumentsSidebar and 4.1 DriveLibraryListView", () => {
  it("hides the Google Drive sidebar section when the viewer has no connections or when documents flag is off", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    const { unmount } = render(
      withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} driveConnections={[]} />),
    );
    await screen.findByText(t("documents.home.empty.title"));
    expect(screen.queryByRole("button", { name: /Google Drive/ })).toBeNull();
    unmount();

    requestMock.mockResolvedValue({ flags: { documents: false }, rum_sample_rate: 0 });
    render(
      withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} driveConnections={connections} />, false),
    );
    expect(await screen.findByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Google Drive/ })).toBeNull();
  });

  it("keeps the Google Drive sidebar section reachable and shows 'Mất kết nối · kết nối lại' in 4.1 when the viewer has zero connections and a bound_connection_lost file", async () => {
    const { promise: listPromise, resolve: resolveList } = Promise.withResolvers<unknown>();
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) return Promise.resolve({ connections: [] });
      if (path.startsWith(DRIVE_LIST_URL)) return listPromise;
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });

    const nav = fakeNav("/acme/doi/documents");
    render(withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} />, true, nav));

    await screen.findByText(t("documents.home.empty.title"));
    // Hidden while the fallback drive-files query is still loading (no flash)
    expect(screen.queryByRole("button", { name: /^Google Drive/ })).toBeNull();

    resolveList({
      files: [
        driveFile({
          id: "df_lost",
          name: "Báo cáo sau khi ngắt kết nối",
          bound_connection_lost: true,
          viewer_access: "connection_lost",
          viewer_connection_id: "conn_disconnected",
          viewer_account_email: "disconnected@gmail.com",
        }),
      ],
      total_count: 1,
      next_cursor: null,
    });

    const driveBtn = (await screen.findAllByRole("button", { name: /^Google Drive/ }))[0]!;
    expect(driveBtn).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: /Drive:/ })).toBeNull();
    // Zero accounts -> Drive row keeps an empty 16px chevron placeholder slot (no chevron button) so icon/name stay aligned.
    const driveRowWrapper = driveBtn.parentElement!;
    expect(driveRowWrapper).toHaveClass("px-2", "gap-1");
    expect(driveRowWrapper.querySelector("[data-chevron]")).toBeNull();
    expect(driveRowWrapper.firstElementChild).toHaveAttribute("data-chevron-placeholder");
    expect(driveRowWrapper.firstElementChild).toHaveClass("size-4", "shrink-0");

    // Clicking the all-accounts row navigates to 4.1 and renders the lost file with reconnect link
    fireEvent.click(driveBtn);
    expect(nav.push).toHaveBeenCalledWith("/acme/doi/documents?view=drive");

    const fileLink = await screen.findByRole("link", { name: "Báo cáo sau khi ngắt kết nối" });
    expect(fileLink).toHaveAttribute("href", "/acme/doi/documents/drive/df_lost");
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("disconnected@gmail.com").length).toBeGreaterThan(0);
    const reconnectLinks = within(table).getAllByRole("link", {
      name: t("driveLibrary.list.reconnect_inline"),
    });
    expect(reconnectLinks.length).toBeGreaterThan(0);
    expect(reconnectLinks[0]).toHaveAttribute(
      "href",
      "/acme/doi/settings?tab=integrations&connect=drive",
    );
  });

  it("renders Google Drive and per-account children in the sidebar with counts, disconnected warning, aria-current, and no 'Người khác liên kết'", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path.startsWith(DRIVE_LIST_URL)) {
        return Promise.resolve({ files: [driveFile()], total_count: 6, next_cursor: null });
      }
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    const nav = fakeNav("/acme/doi/documents?view=drive");
    render(
      withFlag(
        <DocumentsPageView wsId={WS} onOpen={vi.fn()} driveConnections={connections} />,
        true,
        nav,
      ),
    );

    const driveBtn = (await screen.findAllByRole("button", { name: /^Google Drive/ }))[0]!;
    const driveRowWrapper = driveBtn.parentElement!;
    const driveChevron = within(driveRowWrapper).getByRole("button", {
      name: t("documents.tree.collapse", { title: "Google Drive" }),
    });
    expect(driveBtn).toHaveAttribute("aria-current", "page");
    expect(driveRowWrapper).toHaveClass("bg-brand-subtle", "text-brand-subtle-foreground", "px-2", "gap-1");
    expect(driveChevron).toHaveAttribute("aria-expanded", "true");
    expect(driveChevron).not.toHaveAttribute("tabindex", "-1");
    expect(driveChevron).not.toHaveClass("outline-none");
    expect(driveChevron).toHaveClass("size-4", "shrink-0", "pointer-coarse:size-11");
    expect(driveBtn).toHaveTextContent("6");
    expect(driveBtn).toHaveClass("gap-2", "min-w-0", "flex-1");
    expect(driveBtn.firstElementChild).toHaveClass("size-5", "shrink-0");
    expect(driveBtn.lastElementChild).toHaveClass(
      "ml-auto",
      "shrink-0",
      "font-mono",
      "text-caption",
      "tabular-nums",
      "text-muted-foreground",
    );

    const acct1Btn = screen.getAllByRole("button", { name: /Drive: uni-work1@gmail\.com/ })[0]!;
    expect(acct1Btn).not.toHaveAttribute("aria-current");
    expect(acct1Btn).toHaveAttribute("title", "Drive: uni-work1@gmail.com");
    expect(acct1Btn).toHaveStyle({ paddingLeft: "28px" });
    expect(acct1Btn).toHaveClass("pr-2", "gap-2");
    expect(acct1Btn).toHaveTextContent("3");
    expect(acct1Btn.lastElementChild).toHaveClass(
      "ml-auto",
      "shrink-0",
      "font-mono",
      "text-caption",
      "tabular-nums",
      "text-muted-foreground",
    );

    const acct3Btn = screen.getAllByRole("button", { name: /Drive: uni-work3@gmail\.com/ })[0]!;
    expect(acct3Btn).toHaveStyle({ paddingLeft: "28px" });
    expect(acct3Btn).toHaveClass("pr-2", "gap-2");
    expect(acct3Btn).toHaveTextContent(t("driveLibrary.sidebar.disconnected"));
    expect(acct3Btn).toHaveAttribute(
      "title",
      `Drive: uni-work3@gmail.com · ${t("driveLibrary.sidebar.disconnected")}`,
    );
    expect(acct3Btn.lastElementChild).toHaveClass(
      "ml-auto",
      "shrink-0",
      "font-mono",
      "text-caption",
      "tabular-nums",
      "text-muted-foreground",
    );

    expect(screen.queryByText(/Người khác liên kết/)).toBeNull();

    fireEvent.click(acct1Btn);
    expect(nav.push).toHaveBeenCalledWith("/acme/doi/documents?view=drive&account=conn1");
    expect(acct1Btn).toHaveAttribute("aria-current", "page");
    expect(acct1Btn).toHaveClass("bg-brand-subtle", "text-brand-subtle-foreground");
    expect(driveBtn).not.toHaveAttribute("aria-current");

    // Drive chevron collapses and expands the account rows without navigating; native button handles click (including Enter/Space activation).
    fireEvent.click(driveChevron);
    expect(driveChevron).toHaveAttribute("aria-expanded", "false");
    expect(driveChevron).toHaveAccessibleName(t("documents.tree.expand", { title: "Google Drive" }));
    expect(within(driveRowWrapper.parentElement!).queryByRole("button", { name: /Drive: uni-work1@gmail\.com/ })).toBeNull();
    expect(nav.push).toHaveBeenCalledTimes(1);

    fireEvent.click(driveChevron);
    expect(driveChevron).toHaveAttribute("aria-expanded", "true");
    expect(within(driveRowWrapper.parentElement!).getByRole("button", { name: /Drive: uni-work1@gmail\.com/ })).toBeInTheDocument();
  });

  it("does not show a reconnect link for a bound_connection_lost file when the viewer's own access is granted on a healthy connection", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return Promise.resolve({
        files: [
          driveFile({
            id: "df_binder_lost",
            name: "Tệp do người khác liên kết",
            bound_connection_lost: true,
            viewer_access: "granted",
            viewer_connection_id: "conn1",
          }),
        ],
        total_count: 1,
        next_cursor: null,
      });
    });

    render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );

    await screen.findByRole("link", { name: "Tệp do người khác liên kết" });
    const table = screen.getByRole("table");
    expect(
      within(table).queryByRole("link", { name: t("driveLibrary.list.reconnect_inline") }),
    ).toBeNull();
  });

  it("renders a real table with all 5 columns, sharing states, used-in counts, tasks created, and pagination", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      const q = new URLSearchParams(path.split("?")[1] ?? "");
      if (q.get("cursor") === "page2") {
        return Promise.resolve({
          files: [
            driveFile({
              id: "df4",
              name: "Tài liệu Bộ nhớ chung",
              drive_id: "shared-drv-1",
              sharing_state: "unknown",
              used_in_count: 0,
              used_in_tasks: [],
              tasks_created: { count: 0 },
            }),
          ],
          total_count: 4,
          next_cursor: null,
        });
      }
      return Promise.resolve({
        files: [
          driveFile({
            id: "df1",
            name: "Kế hoạch ra mắt Q4",
            sharing_state: "private",
            used_in_count: 5,
            used_in_tasks: [{ task_id: "t1", identifier: "UNI-1042", title: "Kế hoạch", status: "todo" }],
            tasks_created: { count: 4 },
          }),
          driveFile({
            id: "df2",
            name: "Ngân sách marketing Q4",
            icon_kind: "google_sheet",
            sharing_state: "shared",
            shared_user_count: 4,
            used_in_count: 1,
            used_in_tasks: [{ task_id: "t2", identifier: "UNI-1060", title: "Ngân sách", status: "todo" }],
            tasks_created: { count: 0 },
          }),
          driveFile({
            id: "df3",
            name: "Brief thiết kế landing",
            sharing_state: "shared",
            shared_user_count: undefined,
            viewer_connection_id: "conn3",
            viewer_access: "connection_lost",
            viewer_account_email: undefined,
            bound_account_email: "other-member@gmail.com",
            used_in_count: 0,
            used_in_tasks: [],
            tasks_created: { count: 0 },
          }),
        ],
        total_count: 4,
        next_cursor: "page2",
      });
    });

    render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );

    const nameLink = await screen.findByRole("link", { name: "Kế hoạch ra mắt Q4" });
    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.name") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.account") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.access") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.used_in") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.tasks_created") })).toBeInTheDocument();

    expect(nameLink).toHaveAttribute("title", "Kế hoạch ra mắt Q4");
    expect(nameLink).toHaveClass("min-w-0", "max-w-full", "pointer-coarse:min-h-11");
    expect(nameLink.querySelector("span")).toHaveClass("min-w-0", "truncate");
    expect(nameLink.closest("td")).toHaveClass("w-full", "max-w-0");
    expect(nameLink.nextElementSibling).toHaveClass("md:hidden");
    expect(within(table).getAllByText(t("driveLibrary.list.access.private")).length).toBeGreaterThan(0);
    expect(within(table).getByText("UNI-1042 và 4 việc khác")).toBeInTheDocument();
    expect(within(table).getByText("4 việc")).toBeInTheDocument();

    expect(within(table).getAllByText("Chia sẻ với 4 người").length).toBeGreaterThan(0);
    expect(within(table).getByText("UNI-1060")).toBeInTheDocument();

    expect(within(table).getAllByText(t("driveLibrary.list.access.shared")).length).toBeGreaterThan(0);
    expect(within(table).getByText(t("driveLibrary.list.used_in.none"))).toBeInTheDocument();
    const reconnectLinks = within(table).getAllByRole("link", { name: t("driveLibrary.list.reconnect_inline") });
    expect(reconnectLinks.length).toBeGreaterThan(0);
    expect(reconnectLinks[0]).toHaveClass("pointer-coarse:min-h-11");
    // No fallback to bound_account_email when viewer_account_email is absent
    expect(within(table).getAllByText(t("driveLibrary.list.no_account_value")).length).toBeGreaterThan(0);
    expect(within(table).queryByText("other-member@gmail.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.list.load_more") }));
    expect(await within(table).findByText("Tài liệu Bộ nhớ chung")).toBeInTheDocument();
    expect(within(table).getAllByText(t("driveLibrary.list.access.shared_drive")).length).toBeGreaterThan(0);
  });

  it("renders the Browse nav button once, beside the title, not among the actions (WIRE-V1-01)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path.startsWith(DRIVE_LIST_URL)) return Promise.resolve({ files: [], total_count: 0, next_cursor: null });
      return Promise.resolve({});
    });
    render(
      withFlag(
        <DriveLibraryListView
          wsId={WS}
          accountId={null}
          connections={connections}
          navButton={<button type="button">Browse-nav</button>}
        />,
      ),
    );
    const heading = await screen.findByRole("heading", { level: 1 });
    const navButtons = screen.getAllByRole("button", { name: "Browse-nav" });
    expect(navButtons).toHaveLength(1);
    const titleRow = heading.parentElement?.parentElement;
    expect(titleRow).toContainElement(navButtons[0] ?? null);
    const manage = screen.getByRole("link", { name: t("driveLibrary.list.manage_connections") });
    expect(manage.parentElement).not.toContainElement(navButtons[0] ?? null);
  });

  it("shows broken account subtitle, disables 'Thêm từ <email>' when a disconnected account is selected, and renders the reconnect link", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return Promise.resolve({ files: [driveFile()], total_count: 1, next_cursor: null });
    });
    const onAdd = vi.fn();

    render(
      withFlag(
        <DriveLibraryListView
          wsId={WS}
          accountId="conn3"
          connections={connections}
          onAddFromDrive={onAdd}
        />,
      ),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Drive: uni-work3@gmail.com" }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("driveLibrary.list.subtitle_broken"))).toBeInTheDocument();

    const reconnectLink = screen.getByRole("link", { name: t("driveLibrary.list.reconnect_inline") });
    expect(reconnectLink).toHaveAttribute(
      "href",
      "/acme/doi/settings?tab=integrations&connect=drive",
    );

    const addBtn = screen.getByRole("button", { name: "Thêm từ uni-work3@gmail.com" });
    expect(addBtn).toHaveAttribute("aria-disabled", "true");
    expect(addBtn.parentElement).toHaveClass("basis-full", "sm:basis-auto", "justify-start");
    fireEvent.click(addBtn);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("truncates a very long account email in the add button but keeps the full accessible name (WIRE-V2-01)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return Promise.resolve({ files: [driveFile()], total_count: 1, next_cursor: null });
    });
    const longEmail = `${"very.long.local.part.".repeat(3)}name@subdomain.example-company.com`;

    render(
      withFlag(
        <DriveLibraryListView
          wsId={WS}
          accountId="conn1"
          connections={[
            { id: "conn1", google_email: longEmail, needs_reconnect: false, linked_file_count: 1 },
          ]}
        />,
      ),
    );

    const addBtn = await screen.findByRole("button", { name: `Thêm từ ${longEmail}` });
    expect(addBtn).toHaveClass("min-w-0", "max-w-full");
    expect(addBtn).toHaveAttribute("title", `Thêm từ ${longEmail}`);
    expect(screen.getByText(`Thêm từ ${longEmail}`)).toHaveClass("truncate");
  });

  it("shows loading skeleton, empty state with active 'Thêm từ…' buttons, and error state with retry (§7.10)", async () => {
    // 1. Loading skeleton
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return new Promise(() => {});
    });
    const { unmount } = render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );
    const loadingStatus = await screen.findByRole("status", { name: t("documents.library.loading") });
    expect(loadingStatus).toHaveAttribute("aria-busy", "true");
    expect(within(loadingStatus).getByRole("columnheader", { name: t("driveLibrary.list.columns.name") })).toBeInTheDocument();
    unmount();

    // 2. Empty state: W3 Picker is wired so buttons are enabled (no aria-disabled, no unavailable hint)
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return Promise.resolve({ files: [], total_count: 0, next_cursor: null });
    });
    const emptyRender = render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );
    expect(await screen.findByText(t("driveLibrary.list.empty_title"))).toBeInTheDocument();
    const addBtns = screen.getAllByRole("button", { name: t("driveLibrary.list.add_all") });
    expect(addBtns).toHaveLength(2);
    for (const btn of addBtns) {
      expect(btn).not.toHaveAttribute("aria-disabled");
      expect(btn).not.toHaveAttribute("aria-describedby");
    }
    emptyRender.unmount();

    // 3. Error + Retry
    let calls = 0;
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path.startsWith(DRIVE_LIST_URL)) {
        calls += 1;
        if (calls === 1) return Promise.reject(new ApiError("boom", "internal", 500));
        return Promise.resolve({ files: [driveFile()], total_count: 1, next_cursor: null });
      }
      return Promise.resolve({ connections: [] });
    });
    render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );
    expect(await screen.findByText(t("driveLibrary.list.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.list.retry") }));
    expect(await screen.findByText("Kế hoạch ra mắt Q4")).toBeInTheDocument();
  });
  it("focuses the 'Thêm từ…' button on ?pick=1 and strips pick=1 with replace without opening Picker (§7.11)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return Promise.resolve({ files: [], total_count: 0, next_cursor: null });
    });
    const onAdd = vi.fn();
    const nav = fakeNav("/acme/doi/documents?view=drive&pick=1");
    render(
      withFlag(
        <DriveLibraryListView
          wsId={WS}
          accountId={null}
          connections={connections}
          onAddFromDrive={onAdd}
        />,
        true,
        nav,
      ),
    );

    const headerAddBtn = (await screen.findAllByRole("button", { name: t("driveLibrary.list.add_all") }))[0]!;
    await waitFor(() => expect(document.activeElement).toBe(headerAddBtn));
    expect(nav.replace).toHaveBeenCalledWith("/acme/doi/documents?view=drive");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("treats an unknown account id as null for the query and title, and shows inline error + retry on failed load more (W8-R1-14)", async () => {
    let page2Attempt = 0;
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      const q = new URLSearchParams(path.split("?")[1] ?? "");
      if (q.get("cursor") === "page2") {
        page2Attempt += 1;
        if (page2Attempt === 1) {
          return Promise.reject(new ApiError("boom", "internal", 500));
        }
        return Promise.resolve({
          files: [driveFile({ id: "df2", name: "Trang 2 thành công" })],
          total_count: 2,
          next_cursor: null,
        });
      }
      return Promise.resolve({
        files: [driveFile({ id: "df1", name: "Trang 1" })],
        total_count: 2,
        next_cursor: "page2",
      });
    });

    render(
      withFlag(
        <DriveLibraryListView wsId={WS} accountId="stale-conn-id" connections={connections} />,
      ),
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: t("driveLibrary.list.title_all") }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Trang 1")).toBeInTheDocument();
    // First drive-files request did not include connection_id=stale-conn-id
    const listCalls = requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_LIST_URL));
    expect(listCalls[0]?.[0]).toBe(`/api/v1/workspaces/${WS}/drive-files?limit=50`);
    // Trigger load more -> fails on first attempt, shows inline alert + retry
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.list.load_more") }));
    const alertBox = await screen.findByRole("alert");
    expect(within(alertBox).getByText(t("driveLibrary.list.error_title"))).toBeInTheDocument();

    // Retry load more -> succeeds
    fireEvent.click(within(alertBox).getByRole("button", { name: t("driveLibrary.list.retry") }));
    expect(await screen.findByText("Trang 2 thành công")).toBeInTheDocument();
  });

  it("waits for connections to finish loading only when an accountId is selected, firing immediately on 'all accounts' (W8-R2-02, W8-R3-01)", async () => {
    const connSpy = vi
      .spyOn(driveConnectionsModule, "useDriveLibraryConnections")
      .mockReturnValue({
        connections: [],
        isLoading: true,
        driveAvailable: true,
        configWaitForDrive: false,
      });

    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path.startsWith(DRIVE_LIST_URL)) {
        return Promise.resolve({
          files: [driveFile({ id: "df1", name: "Tệp của conn2", connection_id: "conn2" })],
          total_count: 1,
          next_cursor: null,
        });
      }
      return Promise.resolve({ connections: [] });
    });

    // 1. W8-R3-01: no accountId + connections loading -> list GET fires immediately without waiting
    const allRender = render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} />),
    );
    expect(await screen.findByText("Tệp của conn2")).toBeInTheDocument();
    const allListCalls = requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_LIST_URL));
    expect(allListCalls).toHaveLength(1);
    expect(allListCalls[0]?.[0]).toBe(`/api/v1/workspaces/${WS}/drive-files?limit=50`);
    allRender.unmount();
    requestMock.mockClear();

    // 2. W8-R2-02: accountId="conn2" + connections loading -> waits for connections, shows skeleton, no list GET yet
    const { rerender } = render(
      withFlag(<DriveLibraryListView wsId={WS} accountId="conn2" />),
    );

    expect(screen.getByRole("status", { name: t("documents.library.loading") })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_LIST_URL)),
    ).toHaveLength(0);

    // Once connections resolve, query fires with connection_id=conn2 and header renders account title
    connSpy.mockReturnValue({
      connections,
      isLoading: false,
      driveAvailable: true,
      configWaitForDrive: false,
    });
    rerender(withFlag(<DriveLibraryListView wsId={WS} accountId="conn2" />));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Drive: uni-work2@gmail.com" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Tệp của conn2")).toBeInTheDocument();
    const accountListCalls = requestMock.mock.calls.filter(([p]) =>
      String(p).startsWith(DRIVE_LIST_URL),
    );
    expect(accountListCalls).toHaveLength(1);
    expect(accountListCalls[0]?.[0]).toBe(
      `/api/v1/workspaces/${WS}/drive-files?connection_id=conn2&limit=50`,
    );

    connSpy.mockRestore();
  });

  it("loads connections from W1 useDriveConnections (1, 2, needs_reconnect, and connections: null) without props", async () => {
    // 1. Two accounts including one needs_reconnect (both boolean and status='needs_reconnect')
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({
          connections: [
            {
              id: "dc1",
              provider: "google",
              google_email: "one@gmail.com",
              status: "active",
              needs_reconnect: false,
              linked_file_count: 4,
              connected_at: "2026-10-26T09:00:00Z",
            },
            {
              id: "dc2",
              provider: "google",
              google_email: "broken@gmail.com",
              status: "needs_reconnect",
              needs_reconnect: false,
              linked_file_count: 2,
              connected_at: "2026-10-26T09:00:00Z",
            },
          ],
        });
      }
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });

    const { unmount } = render(withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} />));
    const driveBtn = (await screen.findAllByRole("button", { name: /^Google Drive/ }))[0]!;
    expect(driveBtn).toHaveTextContent("6");
    expect(screen.getAllByRole("button", { name: /Drive: one@gmail\.com/ })[0]).toHaveTextContent("4");
    const brokenRow = screen.getAllByRole("button", { name: /Drive: broken@gmail\.com/ })[0]!;
    expect(brokenRow).toHaveTextContent(t("driveLibrary.sidebar.disconnected"));
    // Connected users do not trigger the fallback /drive-files query in the sidebar
    expect(
      requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_LIST_URL)),
    ).toHaveLength(0);
    unmount();

    // 2. Single account
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({
          connections: [
            {
              id: "dc_single",
              provider: "google",
              google_email: "solo@gmail.com",
              status: "active",
              needs_reconnect: false,
              linked_file_count: 1,
              connected_at: "2026-10-26T09:00:00Z",
            },
          ],
        });
      }
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    const singleRender = render(withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} />));
    expect(
      (await screen.findAllByRole("button", { name: /Drive: solo@gmail\.com/ }))[0],
    ).toHaveTextContent("1");
    singleRender.unmount();

    // 3. Server returns `{ connections: null }` -> degrades cleanly to `[]` and hides sidebar section
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({ connections: null });
      }
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    render(withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} />));
    await screen.findByText(t("documents.home.empty.title"));
    expect(screen.queryByRole("button", { name: /^Google Drive/ })).toBeNull();
  });

  it("enforces the W8-R1-05 gate (flag off, drive.available false, and config loading without flashing off state)", async () => {
    // 1. While /api/v1/config is still loading on ?view=drive -> shows loading skeleton, does not flash redirect
    const { promise: configPromise, resolve: resolveConfig } = Promise.withResolvers<unknown>();
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return configPromise;
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({ files: [], total_count: 0, next_cursor: null });
    });

    const loadingNav = fakeNav("/acme/doi/documents?view=drive&account=conn1");
    const loadingRender = render(
      withFlag(
        <DocumentsPageView wsId={WS} onOpen={vi.fn()} />,
        true,
        loadingNav,
        true,
      ),
    );
    expect(screen.getByRole("status", { name: t("documents.library.loading") })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(loadingNav.replace).not.toHaveBeenCalled();
    expect(
      requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_CONNECTIONS_URL)),
    ).toHaveLength(0);

    // Resolve config with drive.available: false -> redirects ?view=drive to plain documents, hides sidebar Drive section, and makes no /drive-connections request (WIRE-R1-03)
    resolveConfig(defaultConfigResponse(false));
    await waitFor(() => expect(loadingNav.replace).toHaveBeenCalledWith("/acme/doi/documents"));
    expect(screen.queryByRole("button", { name: /^Google Drive/ })).toBeNull();
    expect(
      requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_CONNECTIONS_URL)),
    ).toHaveLength(0);
    // The sidebar fallback must not fetch /drive-files either when Drive is unavailable
    expect(
      requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_LIST_URL)),
    ).toHaveLength(0);
    loadingRender.unmount();
    requestMock.mockClear();

    // 2. drive_connector flag off -> hides sidebar Drive section, strips ?view=drive, and makes no /drive-connections request
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true, true, false));
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    const flagOffNav = fakeNav("/acme/doi/documents?view=drive");
    render(
      withFlag(
        <DocumentsPageView wsId={WS} onOpen={vi.fn()} />,
        true,
        flagOffNav,
        false,
      ),
    );
    await waitFor(() => expect(flagOffNav.replace).toHaveBeenCalledWith("/acme/doi/documents"));
    expect(screen.queryByRole("button", { name: /^Google Drive/ })).toBeNull();
    expect(
      requestMock.mock.calls.filter(([p]) => String(p).startsWith(DRIVE_CONNECTIONS_URL)),
    ).toHaveLength(0);
  });

  it("wires 'Thêm từ Google Drive' / 'Thêm từ <email>' to W3 useDrivePicker and refreshes the list after linking", async () => {
    let linked = false;
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_new",
          name: "Tài liệu mới vừa chọn",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "private",
        },
      ],
    });
    requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({
          connections: [
            {
              id: "conn1",
              provider: "google",
              google_email: "uni-work1@gmail.com",
              status: "active",
              needs_reconnect: false,
              linked_file_count: 1,
              connected_at: "2026-10-26T09:00:00Z",
            },
            {
              id: "conn2",
              provider: "google",
              google_email: "uni-work2@gmail.com",
              status: "active",
              needs_reconnect: false,
              linked_file_count: 1,
              connected_at: "2026-10-26T09:05:00Z",
            },
          ],
        });
      }
      if (
        path === `/api/v1/workspaces/${WS}/drive-connections/conn2/picker-token` &&
        init?.method === "POST"
      ) {
        return Promise.resolve({
          access_token: "tok-conn2",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-key",
          app_id: "app-id",
        });
      }
      if (path === DRIVE_LIST_URL && init?.method === "POST") {
        linked = true;
        return Promise.resolve({
          results: [
            {
              external_file_id: "gdoc_new",
              status: "linked",
              file: {
                id: "df_new",
                workspace_id: WS,
                external_file_id: "gdoc_new",
                name: "Tài liệu mới vừa chọn",
                mime_type: "application/vnd.google-apps.document",
                icon_kind: "google_doc",
                sharing_state: "private",
                web_view_link: "https://docs.google.com/document/d/gdoc_new/edit",
                open_url: "https://docs.google.com/document/d/gdoc_new/edit?authuser=uni-work2%40gmail.com",
                viewer_access: "granted",
                viewer_connection_id: "conn2",
                viewer_account_email: "uni-work2@gmail.com",
              },
            },
          ],
        });
      }
      if (path.startsWith(DRIVE_LIST_URL)) {
        return Promise.resolve({
          files: linked
            ? [
                driveFile({
                  id: "df_new",
                  name: "Tài liệu mới vừa chọn",
                  connection_id: "conn2",
                  viewer_connection_id: "conn2",
                  viewer_account_email: "uni-work2@gmail.com",
                }),
              ]
            : [],
          total_count: linked ? 1 : 0,
          next_cursor: null,
        });
      }
      return Promise.resolve({});
    });

    // 1. Selected account `conn2`: clicking "Thêm từ uni-work2@gmail.com" opens Picker directly for conn2, links, and refreshes list
    const { unmount } = render(
      withFlag(
        <DriveLibraryListView
          wsId={WS}
          accountId="conn2"
          pickerAdapter={fakeAdapter}
        />,
      ),
    );

    expect(await screen.findByText(t("driveLibrary.list.empty_title"))).toBeInTheDocument();
    const addAccountBtn = screen.getAllByRole("button", {
      name: "Thêm từ uni-work2@gmail.com",
    })[0]!;
    fireEvent.click(addAccountBtn);

    expect(await screen.findByRole("link", { name: "Tài liệu mới vừa chọn" })).toBeInTheDocument();
    expect(fakeAdapter.calls).toHaveLength(1);
    expect(fakeAdapter.calls[0]?.token).toBe("tok-conn2");
    unmount();

    // 2. All accounts (`accountId={null}`) with 2 connections: clicking "Thêm từ Google Drive" opens Picker's account choice dialog
    render(
      withFlag(
        <DriveLibraryListView
          wsId={WS}
          accountId={null}
          pickerAdapter={fakeAdapter}
        />,
      ),
    );
    expect(await screen.findByRole("link", { name: "Tài liệu mới vừa chọn" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.list.add_all") }));
    const accountDialog = await screen.findByRole("dialog");
    expect(within(accountDialog).getByText("uni-work1@gmail.com")).toBeInTheDocument();
    expect(within(accountDialog).getByText("uni-work2@gmail.com")).toBeInTheDocument();
  });
});
