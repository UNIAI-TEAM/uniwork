import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { WorkspaceProvider } from "../../layout/workspace-context";
import type { NavigationAdapter } from "../../navigation";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import {
  GOOGLE_API_SCRIPT_URL,
  DrivePickerDisclosure,
  createFakeDrivePickerAdapter,
  drivePickerStorageKey,
  googleDrivePickerAdapter,
  resetGooglePickerScriptLoaderForTests,
  resolveDrivePickerAdapter,
  useDrivePicker,
  type DrivePickedFile,
  type DrivePickerAdapter,
  type DrivePickerOpenRequest,
} from "./index";

initI18n();

const user: User = {
  id: "u1",
  email: "an@vietants.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const ACTIVE_CONN_1 = {
  id: "dc_1",
  provider: "google",
  google_email: "uni-work1@gmail.com",
  status: "active",
  needs_reconnect: false,
  linked_file_count: 2,
  connected_at: "2026-10-26T09:42:00Z",
  updated_at: "2026-10-26T09:42:00Z",
};

const ACTIVE_CONN_2 = {
  id: "dc_2",
  provider: "google",
  google_email: "work2@vietants.vn",
  status: "active",
  needs_reconnect: false,
  linked_file_count: 1,
  connected_at: "2026-10-26T09:50:00Z",
  updated_at: "2026-10-26T09:50:00Z",
};

const LOST_CONN = {
  id: "dc_lost",
  provider: "google",
  google_email: "expired@vietants.vn",
  status: "needs_reconnect",
  needs_reconnect: true,
  auth_failed_at: "2026-10-26T10:00:00Z",
  auth_failed_reason: "invalid_grant",
  linked_file_count: 4,
  connected_at: "2026-10-20T09:00:00Z",
  updated_at: "2026-10-26T10:00:00Z",
};

const PICKER_TOKEN_PAYLOAD = {
  access_token: "ya29.fake-picker-token",
  expires_at: "2026-10-26T12:00:00Z",
  developer_key: "dev_key_123",
  app_id: "987654321",
};

function createMemoryStorage(): StorageAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

function makeReceipt(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "df_1",
    workspace_id: "ws1",
    external_file_id: "gdoc_1",
    name: "Kế hoạch ra mắt Q4",
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    sharing_state: "private",
    web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
    open_url:
      "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
    viewer_access: "granted",
    viewer_connection_id: "dc_1",
    viewer_account_email: "uni-work1@gmail.com",
    ...overrides,
  };
}

function PickerHarness({
  taskId,
  forTask,
  adapter,
  storage,
  openRequest,
  onLinked,
  onPicked,
}: {
  taskId?: string | null;
  forTask?: boolean;
  adapter?: DrivePickerAdapter;
  storage?: StorageAdapter;
  openRequest?: DrivePickerOpenRequest;
  onLinked?: (
    results: unknown,
    ctx: { connectionId: string; pickedFiles: DrivePickedFile[] },
  ) => void;
  onPicked?: (ctx: {
    connectionId: string;
    pickedFiles: DrivePickedFile[];
  }) => void;
}) {
  const picker = useDrivePicker({
    wsId: workspace.id,
    taskId,
    forTask,
    adapter,
    storage,
    onLinked,
    onPicked,
  });

  return (
    <div>
      <button
        type="button"
        data-testid="open-picker-btn"
        aria-disabled={picker.pending || undefined}
        onClick={() => picker.open(openRequest)}
      >
        Từ Google Drive
      </button>
      <DrivePickerDisclosure />
      {picker.dialogs}
    </div>
  );
}

function renderHarness(opts: {
  connections?: unknown[];
  pickerTokenHandler?: (connectionId: string) => Promise<unknown>;
  linkHandler?: (body: unknown) => Promise<unknown>;
  taskId?: string | null;
  forTask?: boolean;
  adapter?: DrivePickerAdapter;
  storage?: StorageAdapter;
  openRequest?: DrivePickerOpenRequest;
  navAdapter?: NavigationAdapter;
  onLinked?: (
    results: unknown,
    ctx: { connectionId: string; pickedFiles: DrivePickedFile[] },
  ) => void;
  onPicked?: (ctx: {
    connectionId: string;
    pickedFiles: DrivePickedFile[];
  }) => void;
}) {
  const connections = opts.connections ?? [ACTIVE_CONN_1];
  const nav = opts.navAdapter ?? fakeNav("/acme/team/tasks/task_1");

  requestMock.mockImplementation(
    (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections });
      }
      if (
        typeof path === "string" &&
        path.startsWith("/api/v1/workspaces/ws1/drive-connections/") &&
        path.endsWith("/picker-token") &&
        init?.method === "POST"
      ) {
        const parts = path.split("/");
        const connId = decodeURIComponent(parts[parts.length - 2] ?? "");
        if (opts.pickerTokenHandler) {
          return opts.pickerTokenHandler(connId);
        }
        return Promise.resolve(PICKER_TOKEN_PAYLOAD);
      }
      if (
        path === "/api/v1/workspaces/ws1/drive-files" &&
        init?.method === "POST"
      ) {
        if (opts.linkHandler) {
          return opts.linkHandler(init.body);
        }
        return Promise.resolve({
          results: [
            {
              external_file_id: "gdoc_1",
              outcome: "linked",
              file: makeReceipt(),
            },
          ],
        });
      }
      return Promise.resolve({});
    },
  );

  const rendered = render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <PickerHarness
          taskId={opts.taskId}
          forTask={opts.forTask}
          adapter={opts.adapter}
          storage={opts.storage}
          openRequest={opts.openRequest}
          onLinked={opts.onLinked}
          onPicked={opts.onPicked}
        />
      </WorkspaceProvider>,
      nav,
    ),
  );

  return { ...rendered, nav };
}

beforeEach(() => {
  requestMock.mockReset();
  resetGooglePickerScriptLoaderForTests();
  delete window.__UNIWORK_FAKE_DRIVE_PICKER__;
  delete window.gapi;
  delete window.google;
  document
    .querySelectorAll(`script[src="${GOOGLE_API_SCRIPT_URL}"]`)
    .forEach((el) => el.remove());
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__UNIWORK_FAKE_DRIVE_PICKER__;
  delete window.gapi;
  delete window.google;
});

describe("useDrivePicker & DrivePickerAdapter (W3, UNI-2187)", () => {
  it("renders the single-account disclosure sentence and goes straight to the Picker when 1 active connection exists", async () => {
    const toastSuccessSpy = vi.spyOn(toast, "success");
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "private",
        },
      ],
    });
    const storage = createMemoryStorage();
    const onLinked = vi.fn();

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      storage,
      onLinked,
    });

    // Wait for connections query to settle
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    expect(screen.getByTestId("drive-picker-disclosure")).toHaveTextContent(
      "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive.",
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    // No account dialog shown; picker-token fetched and Picker opened directly
    expect(
      screen.queryByTestId("drive-picker-account-list"),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(fakeAdapter.calls).toHaveLength(1));
    expect(fakeAdapter.calls[0]).toEqual({
      token: "ya29.fake-picker-token",
      developerKey: "dev_key_123",
      appId: "987654321",
      locale: "vi",
      fileIds: undefined,
      multiselect: true,
      title: "Chọn tệp từ Google Drive",
    });

    // Since no taskId was given, links immediately without confirmation dialog
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files",
        {
          method: "POST",
          body: {
            connection_id: "dc_1",
            external_file_ids: ["gdoc_1"],
          },
        },
      ),
    );

    expect(storage.getItem(drivePickerStorageKey("ws1"))).toBe("dc_1");
    expect(toastSuccessSpy).toHaveBeenCalledWith(
      "Đã liên kết 1 tệp từ Google Drive.",
    );
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("shows the account selection dialog when multiple accounts exist, remembers the last choice via StorageAdapter, locks lost accounts, and links with the chosen account", async () => {
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gsheet_1",
          name: "Ngân sách Q4",
          mimeType: "application/vnd.google-apps.spreadsheet",
          sharingState: "shared",
        },
      ],
    });
    const storage = createMemoryStorage();
    // Pre-seed remembered account as dc_2
    storage.setItem(drivePickerStorageKey("ws1"), "dc_2");

    const { nav } = renderHarness({
      connections: [ACTIVE_CONN_1, ACTIVE_CONN_2, LOST_CONN],
      adapter: fakeAdapter,
      storage,
      taskId: "task_1",
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    const accountDialog = await screen.findByRole("dialog");
    const accountList = within(accountDialog).getByTestId("drive-picker-account-list");
    expect(
      within(accountDialog).getByText(
        "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive.",
      ),
    ).toBeInTheDocument();

    const radioButtons = within(accountList).getAllByRole("radio");
    expect(radioButtons).toHaveLength(3);

    // Remembered account dc_2 is pre-selected
    expect(radioButtons[0]).toHaveAttribute("aria-checked", "false");
    expect(radioButtons[1]).toHaveAttribute("aria-checked", "true");

    // Lost account dc_lost is locked with TriangleAlert + "Mất kết nối" + "Kết nối lại"
    const lostRow = screen.getByTestId("drive-picker-account-dc_lost");
    expect(within(lostRow).getByRole("radio")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(lostRow).getByText("Mất kết nối")).toBeInTheDocument();
    const reconnectBtn = within(lostRow).getByRole("button", {
      name: "Kết nối lại expired@vietants.vn",
    });
    expect(reconnectBtn).toBeInTheDocument();

    // Clicking the locked radio does not select it
    fireEvent.click(within(lostRow).getByRole("radio"));
    expect(within(lostRow).getByRole("radio")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(radioButtons[1]).toHaveAttribute("aria-checked", "true");

    // Switch selection to dc_1 and continue
    fireEvent.click(radioButtons[0]!);
    expect(radioButtons[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Mở Google Picker" }));

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/dc_1/picker-token",
        { method: "POST", body: {} },
      ),
    );
    expect(storage.getItem(drivePickerStorageKey("ws1"))).toBe("dc_1");

    // Because picked file has sharingState === "shared", links immediately to task_1 without confirmation dialog
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files",
        {
          method: "POST",
          body: {
            connection_id: "dc_1",
            external_file_ids: ["gsheet_1"],
            task_id: "task_1",
          },
        },
      ),
    );

    // Re-open account step and verify clicking "Kết nối lại" navigates to Settings › Integrations `?connect=drive`
    fireEvent.click(screen.getByTestId("open-picker-btn"));
    const lostRowAgain = await screen.findByTestId(
      "drive-picker-account-dc_lost",
    );
    fireEvent.click(
      within(lostRowAgain).getByRole("button", {
        name: "Kết nối lại expired@vietants.vn",
      }),
    );
    expect(nav.push).toHaveBeenCalledWith(
      "/acme/team/settings?tab=integrations&connect=drive",
    );
  });

  it("shows the confirmation dialog when linking to a task and any picked file has sharingState !== 'shared', and links only after confirm", async () => {
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "private",
        },
        {
          id: "gdoc_2",
          name: "Ngân sách",
          mimeType: "application/vnd.google-apps.spreadsheet",
          sharingState: "shared",
        },
      ],
    });

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      taskId: "task_42",
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    // Confirmation dialog appears with title "Liên kết 2 tệp" and Q6 body copy
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Liên kết 2 tệp" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Tên tệp sẽ hiện cho người xem được việc này. Nội dung vẫn chỉ mở trên Google Drive.",
      ),
    ).toBeInTheDocument();

    // Link endpoint has NOT been called yet
    expect(requestMock).not.toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files",
      expect.anything(),
    );

    // Confirm linking
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Liên kết 2 tệp" }),
    );

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files",
        {
          method: "POST",
          body: {
            connection_id: "dc_1",
            external_file_ids: ["gdoc_1", "gdoc_2"],
            task_id: "task_42",
          },
        },
      ),
    );
  });

  it("supports cancelling the task confirmation dialog without calling linkDriveFiles", async () => {
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Tài liệu nội bộ",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "unknown",
        },
      ],
    });

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      taskId: "task_42",
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(requestMock).not.toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files",
      expect.anything(),
    );
  });

  it("shows toast with Retry when the Google Picker script fails to load, and retries on action click", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");
    let attempt = 0;
    const flakyAdapter: DrivePickerAdapter = {
      open: vi.fn<DrivePickerAdapter["open"]>(() => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.resolve({
            status: "error",
            reason: "script_load_failed",
          });
        }
        return Promise.resolve({
          status: "picked",
          files: [
            {
              id: "gdoc_retry",
              name: "Tệp sau khi thử lại",
              mimeType: "application/vnd.google-apps.document",
              sharingState: "shared",
            },
          ],
        });
      }),
    };

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: flakyAdapter,
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Không mở được Google Picker. Kiểm tra kết nối mạng rồi thử lại.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Thử lại" }),
        }),
      ),
    );

    // Invoke the retry action from the toast options
    const toastOpts = toastErrorSpy.mock.calls[0]?.[1] as
      | { action?: { label: string; onClick: () => void } }
      | undefined;
    expect(toastOpts?.action?.label).toBe("Thử lại");
    act(() => {
      toastOpts?.action?.onClick();
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files",
        {
          method: "POST",
          body: {
            connection_id: "dc_1",
            external_file_ids: ["gdoc_retry"],
          },
        },
      ),
    );
  });

  it("marks the account as 'Mất kết nối' + shows Reconnect when picker-token fails or returns malformed data", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");
    const fakeAdapter = createFakeDrivePickerAdapter();

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      pickerTokenHandler: () => Promise.resolve({ malformed: true }),
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Kết nối Google Drive đã hết hạn. Kết nối lại rồi thử lại.",
      ),
    );

    // Account dialog opens with dc_1 marked "Mất kết nối" and locked, plus "Kết nối lại"
    const accountRow = await screen.findByTestId("drive-picker-account-dc_1");
    expect(within(accountRow).getByText("Mất kết nối")).toBeInTheDocument();
    expect(within(accountRow).getByRole("radio")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      within(accountRow).getByRole("button", {
        name: "Kết nối lại uni-work1@gmail.com",
      }),
    ).toBeInTheDocument();
    expect(fakeAdapter.calls).toHaveLength(0);
  });

  it("renders per-file error reasons (§5.7) and already_linked copy ('Đã có trong Drive: <email>')", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");
    const toastInfoSpy = vi.spyOn(toast, "info");
    const toastSuccessSpy = vi.spyOn(toast, "success");

    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "f_linked",
          name: "Tệp mới",
          mimeType: "application/pdf",
          sharingState: "shared",
        },
        {
          id: "f_already",
          name: "Kế hoạch Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
        {
          id: "f_grant",
          name: "Báo cáo lương",
          mimeType: "application/vnd.google-apps.spreadsheet",
          sharingState: "shared",
        },
        {
          id: "f_not_acc",
          name: "Tệp đã xóa",
          mimeType: "application/pdf",
          sharingState: "shared",
        },
        {
          id: "f_admin",
          name: "Tài liệu tổ chức",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
        {
          id: "f_unavail",
          name: "Slide thuyết trình",
          mimeType: "application/vnd.google-apps.presentation",
          sharingState: "shared",
        },
      ],
    });

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      linkHandler: () =>
        Promise.resolve({
          results: [
            {
              external_file_id: "f_linked",
              outcome: "linked",
              file: makeReceipt({ external_file_id: "f_linked", name: "Tệp mới" }),
            },
            {
              external_file_id: "f_already",
              outcome: "already_linked",
              file: makeReceipt({
                external_file_id: "f_already",
                name: "Kế hoạch Q4",
              }),
              account_email: "uni-work1@gmail.com",
            },
            {
              external_file_id: "f_grant",
              outcome: "error",
              error_code: "drive_grant_required",
            },
            {
              external_file_id: "f_not_acc",
              outcome: "error",
              error_code: "drive_file_not_accessible",
            },
            {
              external_file_id: "f_admin",
              outcome: "error",
              error_code: "blocked_by_workspace_admin",
            },
            {
              external_file_id: "f_unavail",
              outcome: "error",
              error_code: "drive_unavailable",
            },
          ],
        }),
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() =>
      expect(toastSuccessSpy).toHaveBeenCalledWith(
        "Đã liên kết 1 tệp từ Google Drive.",
      ),
    );
    expect(toastInfoSpy).toHaveBeenCalledWith(
      "Kế hoạch Q4 — Đã có trong Drive: uni-work1@gmail.com",
    );
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Báo cáo lương: Bạn chưa cấp cho UniWork quyền đọc tệp này. Chọn lại tệp trong Google Picker rồi thử lại.",
    );
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Tệp đã xóa: Tài khoản Google Drive này không có quyền truy cập tệp hoặc tệp không còn tồn tại.",
    );
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Tài liệu tổ chức: Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive. Hãy nhờ quản trị viên Google Workspace cho phép ứng dụng UniWork.",
    );
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Slide thuyết trình: Google Drive tạm thời không phản hồi. Thử lại sau ít phút.",
    );
  });

  it("degrades a malformed linkDriveFiles response without throwing and calls onLinked with empty results", async () => {
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
      ],
    });
    const onLinked = vi.fn();

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      onLinked,
      linkHandler: () => Promise.resolve({ results: "not-an-array" }),
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() =>
      expect(onLinked).toHaveBeenCalledWith(
        { results: [] },
        expect.objectContaining({ connectionId: "dc_1" }),
      ),
    );
  });

  it("supports window.__UNIWORK_FAKE_DRIVE_PICKER__ in non-production when no adapter prop is passed", async () => {
    window.__UNIWORK_FAKE_DRIVE_PICKER__ = [
      {
        id: "win_fake_1",
        name: "Tệp từ window fake",
        mimeType: "application/pdf",
        sharingState: "shared",
      },
    ];

    const resolved = resolveDrivePickerAdapter();
    const res = await resolved.open({
      token: "t",
      developerKey: "k",
      appId: "a",
      locale: "vi",
    });

    expect(res).toEqual({
      status: "picked",
      files: [
        {
          id: "win_fake_1",
          name: "Tệp từ window fake",
          mimeType: "application/pdf",
          sharingState: "shared",
        },
      ],
    });
  });

  it("googleDrivePickerAdapter loads apis.google.com/js/api.js once, configures views (My Drive, Shared with me, Shared Drives, no folders) or setFileIds, and resolves picked files", async () => {
    const addViewCalls: Array<{
      ownedByMe?: boolean;
      enableDrives?: boolean;
      includeFolders?: boolean;
      selectFolder?: boolean;
      fileIds?: string;
    }> = [];
    const enabledFeatures: string[] = [];
    let configuredLocale = "";
    let pickerCallback:
      | ((data: { action: string; docs?: Array<Record<string, unknown>> }) => void)
      | null = null;

    class FakeDocsView {
      state: {
        ownedByMe?: boolean;
        enableDrives?: boolean;
        includeFolders?: boolean;
        selectFolder?: boolean;
        fileIds?: string;
      } = {};
      setIncludeFolders(v: boolean) {
        this.state.includeFolders = v;
        return this;
      }
      setSelectFolderEnabled(v: boolean) {
        this.state.selectFolder = v;
        return this;
      }
      setOwnedByMe(v: boolean) {
        this.state.ownedByMe = v;
        return this;
      }
      setEnableDrives(v: boolean) {
        this.state.enableDrives = v;
        return this;
      }
      setFileIds(ids: string) {
        this.state.fileIds = ids;
        return this;
      }
    }

    class FakePickerBuilder {
      setOAuthToken() {
        return this;
      }
      setDeveloperKey() {
        return this;
      }
      setAppId() {
        return this;
      }
      setLocale(loc: string) {
        configuredLocale = loc;
        return this;
      }
      setTitle() {
        return this;
      }
      enableFeature(f: string) {
        enabledFeatures.push(f);
        return this;
      }
      addView(v: FakeDocsView) {
        addViewCalls.push(v.state);
        return this;
      }
      setCallback(
        cb: (data: { action: string; docs?: Array<Record<string, unknown>> }) => void,
      ) {
        pickerCallback = cb;
        return this;
      }
      build() {
        return {
          setVisible: (visible: boolean) => {
            if (visible && pickerCallback) {
              pickerCallback({
                action: "picked",
                docs: [
                  {
                    id: "real_doc_1",
                    name: "Bản thiết kế",
                    mimeType: "application/vnd.google-apps.document",
                    isShared: false,
                  },
                ],
              });
            }
          },
        };
      }
    }

    // Intercept script append to simulate loading `https://apis.google.com/js/api.js`
    const appendSpy = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation((node: Node) => {
        const script = node as HTMLScriptElement;
        if (script.src === GOOGLE_API_SCRIPT_URL) {
          window.gapi = {
            load: (_name, cfg) => {
              window.google = {
                picker: {
                  ViewId: { DOCS: "docs" },
                  Feature: {
                    MULTISELECT_ENABLED: "multiselect",
                    SUPPORT_DRIVES: "support_drives",
                  },
                  Action: { PICKED: "picked", CANCEL: "cancel", ERROR: "error" },
                  Document: {
                    ID: "id",
                    NAME: "name",
                    MIME_TYPE: "mimeType",
                    IS_SHARED: "isShared",
                  },
                  DocsView: FakeDocsView as unknown as never,
                  PickerBuilder: FakePickerBuilder as unknown as never,
                },
              };
              if (typeof cfg === "function") cfg();
              else cfg.callback();
            },
          };
          script.onload?.(new Event("load"));
        }
        return node;
      });

    const firstPick = await googleDrivePickerAdapter.open({
      token: "tok_1",
      developerKey: "dev_1",
      appId: "app_1",
      locale: "vi",
      multiselect: true,
    });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(configuredLocale).toBe("vi");
    expect(enabledFeatures).toEqual(["support_drives", "multiselect"]);
    expect(addViewCalls).toEqual([
      { includeFolders: false, selectFolder: false, ownedByMe: true },
      { includeFolders: false, selectFolder: false, ownedByMe: false },
      { includeFolders: false, selectFolder: false, enableDrives: true },
    ]);
    expect(firstPick).toEqual({
      status: "picked",
      files: [
        {
          id: "real_doc_1",
          name: "Bản thiết kế",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "private",
        },
      ],
    });

    // Second call with `fileIds` reuses loaded namespace without appending a second script tag
    addViewCalls.length = 0;
    await googleDrivePickerAdapter.open({
      token: "tok_1",
      developerKey: "dev_1",
      appId: "app_1",
      locale: "en",
      fileIds: ["pre_1", "pre_2"],
      multiselect: false,
    });

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(configuredLocale).toBe("en");
    expect(addViewCalls).toEqual([
      {
        includeFolders: false,
        selectFolder: false,
        fileIds: "pre_1,pre_2",
      },
    ]);
  });
});
