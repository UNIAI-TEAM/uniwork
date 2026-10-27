import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import {
  configureRuntime,
  resetRuntimeConfig,
  runtimeConfig,
} from "@uniwork/core/runtime-config";
import type { User, Workspace } from "@uniwork/core/types";
import type { StorageAdapter } from "@uniwork/core/types/storage";
import { WorkspaceProvider } from "../../layout/workspace-context";
import type { NavigationAdapter } from "../../navigation";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DRIVE_OAUTH_MESSAGE_TYPE } from "../use-drive-connect-popup";
import {
  GOOGLE_API_SCRIPT_URL,
  googleDrivePickerAdapter,
  resetGooglePickerScriptLoaderForTests,
  resolveDrivePickerAdapter,
} from "./drive-picker-adapter";
import {
  DrivePickerDisclosure,
  createFakeDrivePickerAdapter,
  useDrivePicker,
  type DrivePickedFile,
  type DrivePickerAdapter,
  type DrivePickerOpenRequest,
} from "./index";
import { drivePickerStorageKey } from "./use-drive-picker";

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
  access_token: "picker-tok",
  expires_at: "2026-10-26T12:00:00Z",
  developer_key: "dev-key",
  app_id: "app-1",
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
  connectionsHandler?: () => Promise<unknown>;
  pickerTokenHandler?: (connectionId: string) => Promise<unknown>;
  startConnectHandler?: (body: unknown) => Promise<unknown>;
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
        if (opts.connectionsHandler) {
          return opts.connectionsHandler();
        }
        return Promise.resolve({ connections });
      }
      if (
        path === "/api/v1/workspaces/ws1/drive-connections/google/start" &&
        init?.method === "POST"
      ) {
        if (opts.startConnectHandler) {
          return opts.startConnectHandler(init.body);
        }
        return Promise.resolve({
          authorization_url: "https://accounts.google.test/o/oauth2/v2/auth?state=s1",
        });
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
  resetRuntimeConfig();
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
  resetRuntimeConfig();
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

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    expect(screen.getByTestId("drive-picker-disclosure")).toHaveTextContent(
      "UniWork chỉ được quyền với tệp bạn chọn. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive.",
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() => expect(fakeAdapter.calls).toHaveLength(1));
    expect(
      screen.queryByTestId("drive-picker-account-list"),
    ).not.toBeInTheDocument();

    expect(fakeAdapter.calls[0]).toEqual({
      token: "picker-tok",
      developerKey: "dev-key",
      appId: "app-1",
      locale: "vi",
      fileIds: undefined,
      multiselect: true,
      title: "Chọn tệp từ Google Drive",
    });

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

  it("shows the account selection dialog with >=44px coarse hit target, radio indicator, arrow-key navigation, remembered account, and locked lost accounts", async () => {
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
    storage.setItem(drivePickerStorageKey("ws1"), "dc_2");

    renderHarness({
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

    // Coarse-pointer >=44px target on the interactive radio button (R1-9)
    expect(radioButtons[0]?.className).toContain("pointer-coarse:min-h-11");
    expect(radioButtons[1]?.className).toContain("pointer-coarse:min-h-11");

    // Remembered account dc_2 is pre-selected with roving tabIndex and visible indicator (R1-9, R1-10)
    expect(radioButtons[0]).toHaveAttribute("aria-checked", "false");
    expect(radioButtons[0]).toHaveAttribute("tabindex", "-1");
    expect(radioButtons[1]).toHaveAttribute("aria-checked", "true");
    expect(radioButtons[1]).toHaveAttribute("tabindex", "0");
    expect(
      within(accountList).getByTestId("drive-picker-radio-indicator-dc_2"),
    ).toHaveAttribute("data-checked", "true");
    expect(
      within(accountList).getByTestId("drive-picker-radio-indicator-dc_1"),
    ).toHaveAttribute("data-checked", "false");

    // Arrow key navigation skips lost account and wraps between active accounts (R1-10)
    fireEvent.keyDown(radioButtons[1]!, { key: "ArrowDown" });
    expect(radioButtons[0]).toHaveAttribute("aria-checked", "true");
    expect(radioButtons[0]).toHaveAttribute("tabindex", "0");
    expect(
      within(accountList).getByTestId("drive-picker-radio-indicator-dc_1"),
    ).toHaveAttribute("data-checked", "true");

    fireEvent.keyDown(radioButtons[0]!, { key: "ArrowUp" });
    expect(radioButtons[1]).toHaveAttribute("aria-checked", "true");

    // Lost account dc_lost is locked with TriangleAlert + "Mất kết nối" + "Kết nối lại"
    const lostRow = screen.getByTestId("drive-picker-account-dc_lost");
    expect(within(lostRow).getByRole("radio")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(lostRow).getByText("Mất kết nối")).toBeInTheDocument();
    expect(
      within(lostRow).getByRole("button", {
        name: "Kết nối lại expired@vietants.vn",
      }),
    ).toBeInTheDocument();

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
  });

  it("supports cancelling the account selection dialog without fetching picker-token or navigating (R1-13)", async () => {
    const fakeAdapter = createFakeDrivePickerAdapter();
    const { nav } = renderHarness({
      connections: [ACTIVE_CONN_1, ACTIVE_CONN_2],
      adapter: fakeAdapter,
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    const accountDialog = await screen.findByRole("dialog");
    fireEvent.click(within(accountDialog).getByRole("button", { name: "Hủy" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(fakeAdapter.calls).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("runs the W1 OAuth popup flow in place for reconnecting a lost account and for connecting when no account exists, showing inline callback notices without leaving the page (R1-4)", async () => {
    let currentConnections: unknown[] = [];
    const { nav } = renderHarness({
      connectionsHandler: () => Promise.resolve({ connections: currentConnections }),
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    const fakePopupWindow = {
      closed: false,
      close: vi.fn(),
      focus: vi.fn(),
      location: { href: "about:blank" },
    } as unknown as Window;
    const windowOpenSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(fakePopupWindow);

    // 1. No accounts connected: opens account step in place (no navigation.push)
    fireEvent.click(screen.getByTestId("open-picker-btn"));

    const emptyDialog = await screen.findByRole("dialog");
    expect(nav.push).not.toHaveBeenCalled();
    expect(
      within(emptyDialog).getByRole("heading", { name: "Kết nối Google Drive" }),
    ).toBeInTheDocument();

    // Click "Kết nối Google Drive" inside the dialog -> opens popup & posts start without reconnect_connection_id
    fireEvent.click(
      within(emptyDialog).getByRole("button", { name: "Kết nối Google Drive" }),
    );
    expect(windowOpenSpy).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        { method: "POST", body: {} },
      ),
    );

    // Server now has 1 active + 1 lost connection when popup finishes
    currentConnections = [ACTIVE_CONN_1, LOST_CONN];
    const apiOrigin = new URL(runtimeConfig().apiUrl, document.baseURI).origin;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: apiOrigin,
          source: fakePopupWindow,
          data: { type: DRIVE_OAUTH_MESSAGE_TYPE, ok: true, code: "connected" },
        }),
      );
    });

    // Inline callback result banner appears inside the account dialog
    const noticeAlert = await screen.findByTestId("drive-picker-connect-notice");
    expect(noticeAlert).toHaveTextContent(
      "Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc.",
    );

    // 2. Reconnect the lost account in place -> sends reconnect_connection_id and shows inline notice
    const lostRow = await screen.findByTestId("drive-picker-account-dc_lost");
    fireEvent.click(
      within(lostRow).getByRole("button", {
        name: "Kết nối lại expired@vietants.vn",
      }),
    );

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        { method: "POST", body: { reconnect_connection_id: "dc_lost" } },
      ),
    );
    expect(nav.push).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: apiOrigin,
          source: fakePopupWindow,
          data: {
            type: DRIVE_OAUTH_MESSAGE_TYPE,
            ok: false,
            code: "account_mismatch",
          },
        }),
      );
    });

    const mismatchAlert = await screen.findByTestId("drive-picker-connect-notice");
    expect(mismatchAlert).toHaveTextContent("expired@vietants.vn");
  });

  it("waits while the connections list is loading and shows an error toast with retry (no navigation) when the connections list fails (R1-3, R1-13)", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_after_load",
          name: "Tệp sau khi tải",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
      ],
    });

    let callCount = 0;
    const { nav } = renderHarness({
      adapter: fakeAdapter,
      connectionsHandler: () => {
        callCount += 1;
        if (callCount <= 2) {
          return Promise.reject(new ApiError("unavailable", "internal", 503));
        }
        return Promise.resolve({ connections: [ACTIVE_CONN_1] });
      },
    });

    // Wait for initial mount query to fail
    await waitFor(() => expect(callCount).toBe(1));

    // Clicking open() while connections failed refetches, sees error, shows toast + retry, and does NOT navigate
    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Không tải được danh sách tài khoản Google Drive. Kiểm tra kết nối mạng rồi thử lại.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Thử lại" }),
        }),
      ),
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Clicking Retry in the toast succeeds on the next attempt and opens Picker
    const toastOpts = toastErrorSpy.mock.calls[0]?.[1] as
      | { action?: { label: string; onClick: () => void } }
      | undefined;
    act(() => {
      toastOpts?.action?.onClick();
    });

    await waitFor(() => expect(fakeAdapter.calls).toHaveLength(1));
    expect(nav.push).not.toHaveBeenCalled();
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

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Liên kết 2 tệp" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Tên tệp sẽ hiện cho người xem được việc này. Nội dung vẫn chỉ mở trên Google Drive.",
      ),
    ).toBeInTheDocument();

    expect(requestMock).not.toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files",
      expect.anything(),
    );

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

  it("supports draft task mode (forTask: true without taskId), linkOnPick: false, onPicked callback, and fileIds pass-through (R1-5, R1-13)", async () => {
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "draft_doc_1",
          name: "Tài liệu nháp",
          mimeType: "application/vnd.google-apps.document",
          // Omitted sharingState -> treated as unknown -> requires confirmation
        },
      ],
    });
    const onPicked = vi.fn();
    const onLinked = vi.fn();

    renderHarness({
      connections: [ACTIVE_CONN_1],
      adapter: fakeAdapter,
      forTask: true,
      openRequest: {
        fileIds: ["draft_doc_1"],
        multiselect: false,
        linkOnPick: false,
      },
      onPicked,
      onLinked,
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() => expect(fakeAdapter.calls).toHaveLength(1));
    expect(fakeAdapter.calls[0]).toEqual(
      expect.objectContaining({
        fileIds: ["draft_doc_1"],
        multiselect: false,
      }),
    );

    // Confirmation dialog opens because forTask is true and sharingState is omitted (fail-safe unknown)
    const confirmDialog = await screen.findByRole("alertdialog");
    expect(onPicked).not.toHaveBeenCalled();

    fireEvent.click(
      within(confirmDialog).getByRole("button", { name: "Liên kết 1 tệp" }),
    );

    await waitFor(() =>
      expect(onPicked).toHaveBeenCalledWith({
        connectionId: "dc_1",
        pickedFiles: [
          {
            id: "draft_doc_1",
            name: "Tài liệu nháp",
            mimeType: "application/vnd.google-apps.document",
          },
        ],
      }),
    );

    // linkOnPick: false -> POST /drive-files is not called
    expect(requestMock).not.toHaveBeenCalledWith(
      "/api/v1/workspaces/ws1/drive-files",
      expect.anything(),
    );
    expect(onLinked).not.toHaveBeenCalled();
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

  it("marks the account lost via refetch only on connection-broken picker-token errors (auth_failed / 401), while network/5xx/malformed/403-org-suspended errors show a retry toast and keep the account usable (R1-2, R2-3)", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");
    const fakeAdapter = createFakeDrivePickerAdapter();

    let serverLost = false;
    let tokenAttempt = 0;

    renderHarness({
      adapter: fakeAdapter,
      connectionsHandler: () =>
        Promise.resolve({
          connections: [
            serverLost
              ? { ...ACTIVE_CONN_1, status: "needs_reconnect", needs_reconnect: true }
              : ACTIVE_CONN_1,
          ],
        }),
      pickerTokenHandler: () => {
        tokenAttempt += 1;
        if (tokenAttempt === 1) {
          // 1st attempt: transient 503 drive_unavailable -> retry toast, account stays usable
          return Promise.reject(
            new ApiError("Google Drive tạm thời không phản hồi.", "drive_unavailable", 503),
          );
        }
        if (tokenAttempt === 2) {
          // 2nd attempt: malformed 200 -> retry toast, account stays usable
          return Promise.resolve({ malformed: true });
        }
        if (tokenAttempt === 3) {
          // 3rd attempt: 403 organization_suspended -> transient toast with Retry, no reconnect dialog (R2-3)
          return Promise.reject(
            new ApiError("Tổ chức đang tạm ngưng.", "organization_suspended", 403),
          );
        }
        // 4th attempt: connection-broken auth_failed (401) -> server marks needs_reconnect, hook refetches & opens account step
        serverLost = true;
        return Promise.reject(
          new ApiError("Refresh token invalid", "auth_failed", 401),
        );
      },
    });

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      ),
    );

    // Attempt 1: 503 -> retry toast, no account dialog lock
    fireEvent.click(screen.getByTestId("open-picker-btn"));
    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Không lấy được phiên Google Picker. Kiểm tra kết nối mạng rồi thử lại.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Thử lại" }),
        }),
      ),
    );
    expect(screen.queryByTestId("drive-picker-account-dc_1")).not.toBeInTheDocument();

    // Attempt 2: malformed 200 -> retry toast, no account dialog lock
    toastErrorSpy.mockClear();
    fireEvent.click(screen.getByTestId("open-picker-btn"));
    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Không lấy được phiên Google Picker. Kiểm tra kết nối mạng rồi thử lại.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Thử lại" }),
        }),
      ),
    );
    expect(screen.queryByTestId("drive-picker-account-dc_1")).not.toBeInTheDocument();

    // Attempt 3: 403 organization_suspended -> toast with Retry, no reconnect dialog (R2-3)
    toastErrorSpy.mockClear();
    fireEvent.click(screen.getByTestId("open-picker-btn"));
    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Tổ chức đang tạm ngưng.",
        expect.objectContaining({
          action: expect.objectContaining({ label: "Thử lại" }),
        }),
      ),
    );
    expect(screen.queryByTestId("drive-picker-account-dc_1")).not.toBeInTheDocument();

    // Attempt 4: 401 auth_failed -> refetches connections, opens account dialog with dc_1 marked "Mất kết nối"
    toastErrorSpy.mockClear();
    fireEvent.click(screen.getByTestId("open-picker-btn"));
    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Kết nối Google Drive đã hết hạn. Kết nối lại rồi thử lại.",
      ),
    );

    const accountRow = await screen.findByTestId("drive-picker-account-dc_1");
    await waitFor(() =>
      expect(within(accountRow).getByText("Mất kết nối")).toBeInTheDocument(),
    );
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

  it("shows an error toast and reports picked files as not linked when linkDriveFiles returns a malformed or empty response (R1-7)", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error");
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
      expect(toastErrorSpy).toHaveBeenCalledWith(
        "Không liên kết được tệp từ Google Drive. Thử lại.",
      ),
    );
    expect(onLinked).toHaveBeenCalledWith(
      { results: [] },
      expect.objectContaining({
        connectionId: "dc_1",
        pickedFiles: [expect.objectContaining({ id: "gdoc_1" })],
      }),
    );
  });

  it("ignores window.__UNIWORK_FAKE_DRIVE_PICKER__ when allowFakeDrivePicker is false (default) and honours it only when explicitly enabled (R1-1)", async () => {
    window.__UNIWORK_FAKE_DRIVE_PICKER__ = [
      {
        id: "win_fake_1",
        name: "Tệp từ window fake",
        mimeType: "application/pdf",
        sharingState: "shared",
      },
    ];

    // Default RuntimeConfig has allowFakeDrivePicker: false -> window override is ignored
    expect(runtimeConfig().allowFakeDrivePicker).toBe(false);
    expect(resolveDrivePickerAdapter()).toBe(googleDrivePickerAdapter);

    // Explicitly opt in -> window override is honoured
    configureRuntime({ allowFakeDrivePicker: true });
    const resolved = resolveDrivePickerAdapter();
    expect(resolved).not.toBe(googleDrivePickerAdapter);

    const res = await resolved.open({
      token: "tok-a",
      developerKey: "dev-key",
      appId: "app-1",
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

  it("googleDrivePickerAdapter configures folder navigation without folder selection (setIncludeFolders(true) + setSelectFolderEnabled(false)), retries after script load failure, and handles cancel/error actions (R1-6, R1-13)", async () => {
    const addViewCalls: Array<{
      ownedByMe?: boolean;
      enableDrives?: boolean;
      includeFolders?: boolean;
      selectFolder?: boolean;
      fileIds?: string;
    }> = [];
    const enabledFeatures: string[] = [];
    let configuredLocale = "";
    let nextPickerAction: "picked" | "cancel" | "error" = "picked";
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
              if (nextPickerAction === "picked") {
                pickerCallback({
                  action: "picked",
                  docs: [
                    {
                      id: "real_doc_1",
                      name: "Bản thiết kế",
                      mimeType: "application/vnd.google-apps.document",
                    },
                  ],
                });
              } else {
                pickerCallback({ action: nextPickerAction });
              }
            }
          },
        };
      }
    }

    let scriptAttempts = 0;
    const appendSpy = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation((node: Node) => {
        const script = node as HTMLScriptElement;
        if (script.src === GOOGLE_API_SCRIPT_URL) {
          scriptAttempts += 1;
          if (scriptAttempts === 1) {
            script.onerror?.(new Event("error"));
            return node;
          }
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

    // 1st attempt fails to load script -> returns script_load_failed and resets promise
    const failedLoad = await googleDrivePickerAdapter.open({
      token: "tok-a",
      developerKey: "dev-key",
      appId: "app-1",
      locale: "vi",
    });
    expect(failedLoad.status).toBe("error");

    // 2nd attempt appends a fresh script tag, loads picker, and configures folders navigable but not selectable
    const firstPick = await googleDrivePickerAdapter.open({
      token: "tok-a",
      developerKey: "dev-key",
      appId: "app-1",
      locale: "vi",
      multiselect: true,
    });

    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(configuredLocale).toBe("vi");
    expect(enabledFeatures).toEqual(["support_drives", "multiselect"]);
    expect(addViewCalls).toEqual([
      { includeFolders: true, selectFolder: false, ownedByMe: true },
      { includeFolders: true, selectFolder: false, ownedByMe: false },
      { includeFolders: true, selectFolder: false, enableDrives: true },
    ]);
    // Doc without sharing field fails safe to sharingState: "unknown" (R1-5)
    expect(firstPick).toEqual({
      status: "picked",
      files: [
        {
          id: "real_doc_1",
          name: "Bản thiết kế",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "unknown",
        },
      ],
    });

    // 3rd call with `fileIds` and cancel action
    addViewCalls.length = 0;
    nextPickerAction = "cancel";
    const cancelRes = await googleDrivePickerAdapter.open({
      token: "tok-a",
      developerKey: "dev-key",
      appId: "app-1",
      locale: "en",
      fileIds: ["pre_1", "pre_2"],
      multiselect: false,
    });

    expect(appendSpy).toHaveBeenCalledTimes(2);
    expect(configuredLocale).toBe("en");
    expect(addViewCalls).toEqual([
      {
        includeFolders: true,
        selectFolder: false,
        fileIds: "pre_1,pre_2",
      },
    ]);
    expect(cancelRes).toEqual({ status: "cancelled" });
  });
  it("folder mode asks the adapter for a single folder pick and hands it over without linking or the task confirmation", async () => {
    const linkHandler = vi.fn(() => Promise.resolve({ results: [] }));
    const onPicked = vi.fn();
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "fld_1",
          name: "Hợp đồng",
          mimeType: "application/vnd.google-apps.folder",
          sharingState: "private",
        },
      ],
    });
    renderHarness({
      adapter: fakeAdapter,
      taskId: "task_1",
      linkHandler,
      onPicked,
      openRequest: { connectionId: "dc_1", folder: { parentId: "fld_1" } },
    });

    fireEvent.click(screen.getByTestId("open-picker-btn"));

    await waitFor(() => expect(onPicked).toHaveBeenCalledTimes(1));
    expect(fakeAdapter.calls[0]).toMatchObject({
      multiselect: false,
      selectFolder: { parentId: "fld_1" },
      title: "Chọn thư mục cần lấy tên",
    });
    expect(onPicked.mock.calls[0]![0]).toMatchObject({ connectionId: "dc_1" });
    expect(linkHandler).not.toHaveBeenCalled();
    // A private folder would have asked the task confirmation for a file; a folder never does.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("googleDrivePickerAdapter folder mode builds one folder-only view that selects folders inside the parent", async () => {
    const views: Array<Record<string, unknown>> = [];
    const features: string[] = [];
    class FakeDocsView {
      state: Record<string, unknown> = {};
      setIncludeFolders(v: boolean) {
        this.state.includeFolders = v;
        return this;
      }
      setSelectFolderEnabled(v: boolean) {
        this.state.selectFolder = v;
        return this;
      }
      setMimeTypes(v: string) {
        this.state.mimeTypes = v;
        return this;
      }
      setParent(v: string) {
        this.state.parent = v;
        return this;
      }
    }
    class FakePickerBuilder {
      cb: ((data: { action: string; docs?: Array<Record<string, unknown>> }) => void) | null = null;
      setOAuthToken() { return this; }
      setDeveloperKey() { return this; }
      setAppId() { return this; }
      setLocale() { return this; }
      setTitle() { return this; }
      enableFeature(f: string) { features.push(f); return this; }
      addView(v: FakeDocsView) { views.push(v.state); return this; }
      setCallback(cb: FakePickerBuilder["cb"]) { this.cb = cb; return this; }
      build() {
        return {
          setVisible: () =>
            this.cb?.({
              action: "picked",
              docs: [{ id: "fld_9", name: "Hợp đồng", mimeType: "application/vnd.google-apps.folder" }],
            }),
        };
      }
    }
    window.google = {
      picker: {
        ViewId: { DOCS: "docs" },
        Feature: { MULTISELECT_ENABLED: "multiselect", SUPPORT_DRIVES: "support_drives" },
        Action: { PICKED: "picked", CANCEL: "cancel", ERROR: "error" },
        Document: { ID: "id", NAME: "name", MIME_TYPE: "mimeType" },
        DocsView: FakeDocsView as unknown as never,
        PickerBuilder: FakePickerBuilder as unknown as never,
      },
    };

    const result = await googleDrivePickerAdapter.open({
      token: "tok",
      developerKey: "dev",
      appId: "app",
      locale: "vi",
      multiselect: true,
      fileIds: ["ignored"],
      selectFolder: { parentId: "fld_9" },
    });

    expect(views).toEqual([
      {
        includeFolders: true,
        selectFolder: true,
        mimeTypes: "application/vnd.google-apps.folder",
        parent: "fld_9",
      },
    ]);
    // One pick only: multiselect is never enabled for a folder.
    expect(features).toEqual(["support_drives"]);
    expect(result).toMatchObject({ status: "picked", files: [{ id: "fld_9", mimeType: "application/vnd.google-apps.folder" }] });
  });
});
