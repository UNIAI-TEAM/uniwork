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
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DocumentsPageView } from "../documents-page-view";
import { buildDocumentsViewUrl, viewFromSearchParams } from "../documents-view-url";
import { DriveLibraryListView } from "./drive-library-list-view";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const WS = "ws1";
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

function withFlag(ui: React.ReactElement, on = true, nav = fakeNav()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={sessionUser}>
      <FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>
    </WorkspaceProvider>,
    nav,
  );
}

beforeEach(() => {
  requestMock.mockReset();
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

  it("renders Google Drive and per-account children in the sidebar with counts, disconnected warning, aria-current, and no 'Người khác liên kết'", async () => {
    requestMock.mockImplementation((path: string) => {
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

    const driveBtn = screen.getAllByRole("button", { name: /^Google Drive/ })[0]!;
    expect(driveBtn).toHaveAttribute("aria-current", "page");
    expect(driveBtn).toHaveTextContent("6");

    const acct1Btn = screen.getAllByRole("button", { name: /Drive: uni-work1@gmail\.com/ })[0]!;
    expect(acct1Btn).not.toHaveAttribute("aria-current");
    expect(acct1Btn).toHaveTextContent("3");

    const acct3Btn = screen.getAllByRole("button", { name: /Drive: uni-work3@gmail\.com/ })[0]!;
    expect(acct3Btn).toHaveTextContent(t("driveLibrary.sidebar.disconnected"));

    expect(screen.queryByText(/Người khác liên kết/)).toBeNull();

    fireEvent.click(acct1Btn);
    expect(nav.push).toHaveBeenCalledWith("/acme/doi/documents?view=drive&account=conn1");
    expect(acct1Btn).toHaveAttribute("aria-current", "page");
    expect(driveBtn).not.toHaveAttribute("aria-current");
  });

  it("renders a real table with all 5 columns, sharing states, used-in counts, tasks created, and pagination", async () => {
    requestMock.mockImplementation((path: string) => {
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
            viewer_account_email: "uni-work3@gmail.com",
            viewer_access: "connection_lost",
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

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.name") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.account") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.access") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.used_in") })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: t("driveLibrary.list.columns.tasks_created") })).toBeInTheDocument();

    expect(within(table).getByText("Kế hoạch ra mắt Q4")).toBeInTheDocument();
    expect(within(table).getByText(t("driveLibrary.list.access.private"))).toBeInTheDocument();
    expect(within(table).getByText("UNI-1042 và 4 việc khác")).toBeInTheDocument();
    expect(within(table).getByText("4 việc")).toBeInTheDocument();

    expect(within(table).getByText("Chia sẻ với 4 người")).toBeInTheDocument();
    expect(within(table).getByText("UNI-1060")).toBeInTheDocument();

    expect(within(table).getByText(t("driveLibrary.list.access.shared"))).toBeInTheDocument();
    expect(within(table).getByText(t("driveLibrary.list.used_in.none"))).toBeInTheDocument();
    expect(within(table).getByText(t("driveLibrary.list.reconnect_inline"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.list.load_more") }));
    expect(await within(table).findByText("Tài liệu Bộ nhớ chung")).toBeInTheDocument();
    expect(within(table).getByText(t("driveLibrary.list.access.shared_drive"))).toBeInTheDocument();
  });

  it("shows broken account subtitle and disables 'Thêm từ <email>' when a disconnected account is selected", async () => {
    requestMock.mockResolvedValue({ files: [driveFile()], total_count: 1, next_cursor: null });
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

    const addBtn = screen.getByRole("button", { name: "Thêm từ uni-work3@gmail.com" });
    expect(addBtn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(addBtn);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows loading skeleton, empty state, and error state with retry (§7.10)", async () => {
    // 1. Loading skeleton
    requestMock.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );
    expect(screen.getByLabelText(t("documents.library.loading"))).toHaveAttribute("aria-busy", "true");
    unmount();

    // 2. Empty state
    requestMock.mockResolvedValue({ files: [], total_count: 0, next_cursor: null });
    const emptyRender = render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );
    expect(await screen.findByText(t("driveLibrary.list.empty_title"))).toBeInTheDocument();
    emptyRender.unmount();

    // 3. Error + Retry
    let calls = 0;
    requestMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new ApiError("boom", "internal", 500));
      return Promise.resolve({ files: [driveFile()], total_count: 1, next_cursor: null });
    });
    render(
      withFlag(<DriveLibraryListView wsId={WS} accountId={null} connections={connections} />),
    );
    expect(await screen.findByText(t("driveLibrary.list.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.list.retry") }));
    expect(await screen.findByText("Kế hoạch ra mắt Q4")).toBeInTheDocument();
  });

  it("focuses the 'Thêm từ…' button on ?pick=1 and strips pick=1 with replace without opening Picker (§7.11)", async () => {
    requestMock.mockResolvedValue({ files: [], total_count: 0, next_cursor: null });
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

    const headerAddBtn = screen.getAllByRole("button", { name: t("driveLibrary.list.add_all") })[0]!;
    await waitFor(() => expect(document.activeElement).toBe(headerAddBtn));
    expect(nav.replace).toHaveBeenCalledWith("/acme/doi/documents?view=drive");
    expect(onAdd).not.toHaveBeenCalled();
  });
});
