import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagService, FeatureFlagsProvider, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import type { NavigationAdapter } from "../../navigation";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { IntegrationsTab } from "./integrations-tab";
import { SettingsPage } from "./settings-page";

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

const AUTH_URL = "https://accounts.google.test/o/oauth2/v2/auth?state=s1";

type FakePopup = { closed: boolean; close: () => void; focus: () => void; location: { href: string } };
const openSpy = vi.fn<typeof window.open>();

function setupFakePopup() {
  const popup: FakePopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    focus: vi.fn(),
    location: { href: "" },
  };
  openSpy.mockReturnValue(popup as unknown as Window);
  window.open = openSpy;
  return { popup, openSpy };
}

function postDriveOAuthMessage(popup: FakePopup, ok: boolean, code: string) {
  const event = new MessageEvent("message", {
    origin: new URL(runtimeConfig().apiUrl, window.location.href).origin,
    data: { type: "uniwork:drive-oauth", ok, code },
  });
  Object.defineProperty(event, "source", { value: popup });
  act(() => {
    window.dispatchEvent(event);
  });
}

function renderTab(
  accounts: unknown[],
  opts?: {
    driveFlag?: boolean;
    driveAvailable?: boolean;
    driveConnections?: unknown[];
    navAdapter?: NavigationAdapter;
  },
) {
  const driveFlag = opts?.driveFlag ?? false;
  const driveAvailable = opts?.driveAvailable ?? false;
  let currentConnections = opts?.driveConnections ?? [];

  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/config") {
      return Promise.resolve({
        flags: { drive_connector: driveFlag },
        rum_sample_rate: 0,
        drive: { available: driveAvailable },
      });
    }
    if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
      return Promise.resolve({ accounts });
    }
    if (path === "/api/v1/workspaces/ws1/drive-connections") {
      return Promise.resolve({ connections: currentConnections });
    }
    if (path === "/api/v1/workspaces/ws1/drive-connections/google/start" && init?.method === "POST") {
      return Promise.resolve({ authorization_url: AUTH_URL });
    }
    if (typeof path === "string" && path.startsWith("/api/v1/workspaces/ws1/drive-connections/") && init?.method === "DELETE") {
      const id = decodeURIComponent(path.split("/").pop() ?? "");
      currentConnections = currentConnections.filter(
        (c) => typeof c === "object" && c !== null && "id" in c && c.id !== id,
      );
      return Promise.resolve({ status: "ok" });
    }
    return Promise.resolve({});
  });

  const service = new FeatureFlagService(
    new StaticProvider({ drive_connector: { default: driveFlag } }),
  );
  const nav = opts?.navAdapter ?? fakeNav("/acme/team/settings?tab=integrations");
  const rendered = render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <IntegrationsTab />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
      nav,
    ),
  );
  return { ...rendered, nav, setConnections: (next: unknown[]) => { currentConnections = next; } };
}

beforeEach(() => {
  requestMock.mockReset();
  openSpy.mockReset();
  window.open = openSpy;
});

describe("IntegrationsTab", () => {
  it("lists Email Hub as the real connection, linked to the Email screen", async () => {
    renderTab([]);
    const available = screen.getByRole("list", { name: "Dùng được" });
    expect(within(available).getByText("Email Hub")).toBeInTheDocument();
    expect(
      within(available).getByText("Mỗi người tự kết nối hộp thư: Gmail, Outlook, Yahoo hoặc tên miền riêng"),
    ).toBeInTheDocument();
    expect(await within(available).findByText("Bạn chưa kết nối")).toBeInTheDocument();
    expect(within(available).getByRole("link", { name: "Kết nối hộp thư" })).toHaveAttribute("href", "/acme/team/email");
  });

  it("counts the reader's own connected mailboxes", async () => {
    renderTab([{ id: "a1", email_address: "an@gmail.com", provider: "gmail", connected_at: "2026-09-01T00:00:00Z" }]);
    expect(await screen.findByText("Bạn đã kết nối 1 hộp thư")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở Email Hub" })).toBeInTheDocument();
  });

  it("adds how many of the reader's mailboxes need reconnecting", async () => {
    const mailbox = { provider: "gmail", connected_at: "2026-09-01T00:00:00Z" };
    renderTab([
      { ...mailbox, id: "a1", email_address: "an@gmail.com", needs_reconnect: true },
      { ...mailbox, id: "a2", email_address: "binh@gmail.com" },
    ]);
    expect(await screen.findByText("Bạn đã kết nối 2 hộp thư · 1 hộp thư cần kết nối lại")).toBeInTheDocument();
  });

  it("says the count failed to load and offers a neutral way in, not \"connect\"", async () => {
    requestMock.mockImplementation((path: string) =>
      path === "/api/v1/workspaces/ws1/email-hub/accounts" ? Promise.reject(new Error("offline")) : Promise.resolve({}),
    );
    render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={user}><IntegrationsTab /></WorkspaceProvider>));
    const available = screen.getByRole("list", { name: "Dùng được" });
    expect(await within(available).findByText("Không tải được")).toBeInTheDocument();
    expect(within(available).queryByText("Bạn chưa kết nối")).toBeNull();
    expect(within(available).getByRole("link", { name: "Mở Email Hub" })).toBeInTheDocument();
  });

  it("shows only documented plans, locked, and prints the description once", () => {
    renderTab([]);
    const planned = screen.getByRole("list", { name: "Trong lộ trình" });
    expect(within(planned).getAllByText("Sắp có")).toHaveLength(1);
    expect(within(planned).getByText("Webhook")).toBeInTheDocument();
    // Google and Microsoft sign-in shipped inside Email Hub (GĐ3); it is no longer a plan.
    expect(within(planned).queryByText("Gmail và Microsoft 365")).toBeNull();
    expect(within(planned).queryByRole("link")).toBeNull();
    expect(within(planned).queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Slack/i)).toBeNull();
    expect(screen.getAllByText(/Nối UniWork với công cụ bạn đang dùng/)).toHaveLength(1);
  });

  describe("Google Drive row (W1, UNI-2186)", () => {
    it("hides the Google Drive row when flag drive_connector is off or drive.available is false", async () => {
      const { unmount: unmount1 } = renderTab([], { driveFlag: false, driveAvailable: true });
      expect(await screen.findByText("Email Hub")).toBeInTheDocument();
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith("/api/v1/config", expect.anything()),
      );
      await act(async () => {});
      expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
      unmount1();

      requestMock.mockClear();
      const { unmount: unmount2 } = renderTab([], { driveFlag: true, driveAvailable: false });
      expect(await screen.findByText("Email Hub")).toBeInTheDocument();
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith("/api/v1/config", expect.anything()),
      );
      await act(async () => {});
      expect(screen.queryByText("Google Drive")).not.toBeInTheDocument();
      unmount2();
    });

    it("hides the connect action while the connections list is still loading, then reveals it once loaded", async () => {
      const { promise: listPromise, resolve: resolveList } = Promise.withResolvers<unknown>();
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return Promise.resolve({
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return listPromise;
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: true } }),
      );
      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <IntegrationsTab />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          fakeNav("/acme/team/settings?tab=integrations"),
        ),
      );

      expect(await screen.findByText("Google Drive")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kết nối Google Drive" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Kết nối thêm tài khoản" })).not.toBeInTheDocument();
      expect(screen.queryByText("Chưa kết nối")).not.toBeInTheDocument();

      await act(async () => {
        resolveList({ connections: [] });
      });
      expect(await screen.findByRole("button", { name: "Kết nối Google Drive" })).toBeInTheDocument();
      expect(screen.getByText("Chưa kết nối")).toBeInTheDocument();
    });

    it("shows the Google Drive row when both flag drive_connector and drive.available are true (1.1 not connected)", async () => {
      renderTab([], { driveFlag: true, driveAvailable: true });
      const available = screen.getByRole("list", { name: "Dùng được" });
      expect(await within(available).findByText("Google Drive")).toBeInTheDocument();
      expect(await within(available).findByText("Chưa kết nối")).toBeInTheDocument();
      expect(within(available).getByText("Mới")).toBeInTheDocument();
      expect(
        within(available).getByText(
          "Liên kết tài liệu Google Drive vào việc. UNI đọc tài liệu và đề xuất việc để bạn duyệt. UniWork chỉ lưu liên kết, nội dung vẫn nằm trên Google Drive.",
        ),
      ).toBeInTheDocument();
      expect(
        within(available).getByText(
          "UniWork không thấy các tệp khác trên Google Drive. Mỗi lần liên kết, bạn tự chọn tệp. UniWork không xóa tệp của bạn.",
        ),
      ).toBeInTheDocument();
      expect(await within(available).findByRole("button", { name: "Kết nối Google Drive" })).toBeInTheDocument();
    });

    it("shows the popup blocked message when window.open returns null", async () => {
      openSpy.mockReturnValue(null);
      renderTab([], { driveFlag: true, driveAvailable: true });
      const connectBtn = await screen.findByRole("button", { name: "Kết nối Google Drive" });
      fireEvent.click(connectBtn);

      expect(
        await screen.findByText(
          "Trình duyệt đã chặn cửa sổ đăng nhập. Cho phép cửa sổ bật lên (pop-up) với UniWork rồi thử lại.",
        ),
      ).toBeInTheDocument();
    });

    it.each([
      ["connected", true, "Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc."],
      ["reconnected", true, "Đã kết nối lại Google Drive."],
      ["consent_required", false, "Google chưa cấp quyền truy cập lâu dài. Thử lại và cho phép quyền UniWork yêu cầu."],
      [
        "scope_not_granted",
        false,
        "Bạn chưa cấp quyền chọn tệp Google Drive cho UniWork. Kết nối lại và đánh dấu quyền truy cập tệp khi Google hỏi.",
      ],
      [
        "account_mismatch",
        false,
        "Bạn đã đăng nhập bằng tài khoản Google khác với tài khoản cần kết nối lại. Chọn đúng tài khoản cần kết nối lại hoặc dùng \"Kết nối thêm tài khoản\".",
      ],
      [
        "state_invalid",
        false,
        "Phiên kết nối đã hết hạn hoặc được mở ở trình duyệt khác. Thử lại từ cửa sổ này.",
      ],
      ["retry_connect", false, "Kết nối vừa bị ngắt ở nơi khác, hãy thử lại sau ít phút."],
      [
        "blocked_by_workspace_admin",
        false,
        "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive. Hãy nhờ quản trị viên Google Workspace cho phép ứng dụng UniWork.",
      ],
      ["access_denied", false, "Bạn đã hủy đăng nhập hoặc từ chối cấp quyền cho UniWork."],
      ["provider_error", false, "Google Drive tạm thời không phản hồi. Thử lại sau ít phút."],
      ["some_future_code", false, "Không hoàn tất được kết nối Google Drive. Thử lại."],
    ] as const)("renders the sentence for callback code %s", async (code, ok, expectedText) => {
      const { popup } = setupFakePopup();
      renderTab([], { driveFlag: true, driveAvailable: true });

      fireEvent.click(await screen.findByRole("button", { name: "Kết nối Google Drive" }));
      await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));

      postDriveOAuthMessage(popup, ok, code);
      expect(await screen.findByText(expectedText)).toBeInTheDocument();
    });

    it("shows the closed notice when the popup window closes before completing and refetches connections", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { popup } = setupFakePopup();
        renderTab([], { driveFlag: true, driveAvailable: true });

        const connectBtn = await screen.findByRole("button", { name: "Kết nối Google Drive" });
        fireEvent.click(connectBtn);
        await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));

        const callsBeforeClose = requestMock.mock.calls.filter(
          (c) => c[0] === "/api/v1/workspaces/ws1/drive-connections",
        ).length;

        popup.closed = true;
        await act(async () => {
          vi.advanceTimersByTime(450);
        });

        expect(
          await screen.findByText("Cửa sổ đăng nhập đã đóng trước khi kết nối xong. Thử lại."),
        ).toBeInTheDocument();
        await waitFor(() => {
          const callsAfterClose = requestMock.mock.calls.filter(
            (c) => c[0] === "/api/v1/workspaces/ws1/drive-connections",
          ).length;
          expect(callsAfterClose).toBeGreaterThan(callsBeforeClose);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows the unknown failure notice when the start API rejects and closes the popup", async () => {
      const { popup } = setupFakePopup();
      renderTab([], { driveFlag: true, driveAvailable: true });
      const connectBtn = await screen.findByRole("button", { name: "Kết nối Google Drive" });

      const baseImpl = requestMock.getMockImplementation()!;
      requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
        if (path === "/api/v1/workspaces/ws1/drive-connections/google/start" && init?.method === "POST") {
          return Promise.reject(new Error("server down"));
        }
        return baseImpl(path, init);
      });

      fireEvent.click(connectBtn);
      expect(
        await screen.findByText("Không hoàn tất được kết nối Google Drive. Thử lại."),
      ).toBeInTheDocument();
      expect(popup.close).toHaveBeenCalled();
    });

    it("shows load error with a Thử lại button that refetches the connections list", async () => {
      let failLoad = true;
      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return Promise.resolve({
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          if (failLoad) return Promise.reject(new Error("network error"));
          return Promise.resolve({ connections: [] });
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: true } }),
      );
      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <IntegrationsTab />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          fakeNav("/acme/team/settings?tab=integrations"),
        ),
      );

      expect(await screen.findByText("Không tải được")).toBeInTheDocument();
      const retryBtn = screen.getByRole("button", { name: "Thử lại" });

      failLoad = false;
      fireEvent.click(retryBtn);
      expect(await screen.findByRole("button", { name: "Kết nối Google Drive" })).toBeInTheDocument();
      expect(screen.getByText("Chưa kết nối")).toBeInTheDocument();
    });

    it("marks the connect button aria-disabled while busy and blocks a second click", async () => {
      const { popup } = setupFakePopup();
      renderTab([], { driveFlag: true, driveAvailable: true });

      const connectBtn = await screen.findByRole("button", { name: "Kết nối Google Drive" });
      fireEvent.click(connectBtn);
      await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));

      const busyBtn = screen.getByRole("button", { name: "Đang kết nối…" });
      expect(busyBtn).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(busyBtn);
      const startCalls = requestMock.mock.calls.filter(
        (c) => c[0] === "/api/v1/workspaces/ws1/drive-connections/google/start",
      );
      expect(startCalls).toHaveLength(1);
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it("renders connected accounts (including lost account reconnect with reconnect_connection_id), UNI permissions block, add account, and disconnect confirmation", async () => {
      const { popup } = setupFakePopup();
      const activeConn = {
        id: "dc_1",
        provider: "google",
        google_email: "uni-work1@gmail.com",
        status: "active",
        needs_reconnect: false,
        linked_file_count: 3,
        connected_at: "2026-10-26T09:42:00Z",
        updated_at: "2026-10-26T09:42:00Z",
      };
      const lostConn = {
        id: "dc_2",
        provider: "google",
        google_email: "uni-work2@gmail.com",
        status: "needs_reconnect",
        needs_reconnect: true,
        linked_file_count: 1,
        connected_at: "2026-10-25T08:00:00Z",
        updated_at: "2026-10-26T10:00:00Z",
        auth_failed_at: "2026-10-26T10:00:00Z",
        auth_failed_reason: "invalid_grant",
      };

      renderTab([], {
        driveFlag: true,
        driveAvailable: true,
        driveConnections: [activeConn, lostConn],
      });

      expect(await screen.findByText("Đã kết nối 2 tài khoản · 1 mất kết nối")).toBeInTheDocument();
      expect(screen.getByText("uni-work1@gmail.com")).toBeInTheDocument();
      expect(screen.getByText("uni-work2@gmail.com")).toBeInTheDocument();
      expect(screen.getByText("Đang hoạt động")).toBeInTheDocument();
      expect(screen.getByText("Mất kết nối · kết nối lại")).toBeInTheDocument();
      expect(screen.getByText("UNI được làm gì với tài liệu đã liên kết")).toBeInTheDocument();
      expect(screen.getByText("Chỉ tệp bạn chọn")).toBeInTheDocument();
      expect(screen.getByText("4 tài liệu đã liên kết")).toBeInTheDocument();
      expect(screen.getByText("Chỉ liên kết, không lưu nội dung")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Kết nối thêm tài khoản" })).toBeInTheDocument();

      // "Kết nối thêm tài khoản" sends body: {} (no reconnect_connection_id)
      fireEvent.click(screen.getByRole("button", { name: "Kết nối thêm tài khoản" }));
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/workspaces/ws1/drive-connections/google/start",
          { method: "POST", body: {} },
        ),
      );
      await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
      postDriveOAuthMessage(popup, true, "connected");
      expect(
        await screen.findByText("Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc."),
      ).toBeInTheDocument();

      // Reconnect on the lost account clears the previous notice and passes reconnect_connection_id
      const reconnectBtn = screen.getByRole("button", { name: "Kết nối lại uni-work2@gmail.com" });
      fireEvent.click(reconnectBtn);
      expect(
        screen.queryByText("Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc."),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/workspaces/ws1/drive-connections/google/start",
          { method: "POST", body: { reconnect_connection_id: "dc_2" } },
        ),
      );
      await waitFor(() => expect(popup.location.href).toBe(AUTH_URL));
      postDriveOAuthMessage(popup, false, "account_mismatch");
      expect(
        await screen.findByText(
          "Bạn đã đăng nhập bằng tài khoản Google khác với tài khoản cần kết nối lại. Chọn đúng tài khoản uni-work2@gmail.com hoặc dùng \"Kết nối thêm tài khoản\".",
        ),
      ).toBeInTheDocument();

      // Disconnect error shows error toast and keeps dialog open, then success shows toast, clears notice, and removes account
      const toastSuccessSpy = vi.spyOn(toast, "success");
      const toastErrorSpy = vi.spyOn(toast, "error");
      const baseImpl = requestMock.getMockImplementation()!;
      let failNextDelete = true;
      requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
        if (
          typeof path === "string" &&
          path.startsWith("/api/v1/workspaces/ws1/drive-connections/") &&
          init?.method === "DELETE" &&
          failNextDelete
        ) {
          failNextDelete = false;
          return Promise.reject(new Error(""));
        }
        return baseImpl(path, init);
      });

      fireEvent.click(screen.getByRole("button", { name: "Ngắt kết nối uni-work1@gmail.com" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Ngắt kết nối uni-work1@gmail.com?")).toBeInTheDocument();

      // First click fails -> toast error
      fireEvent.click(within(dialog).getByRole("button", { name: "Ngắt kết nối" }));
      await waitFor(() =>
        expect(toastErrorSpy).toHaveBeenCalledWith("Chưa ngắt được kết nối. Thử lại."),
      );

      // Second click succeeds -> toast success, notice cleared, account removed
      fireEvent.click(within(dialog).getByRole("button", { name: "Ngắt kết nối" }));
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/workspaces/ws1/drive-connections/dc_1",
          { method: "DELETE" },
        ),
      );
      await waitFor(() =>
        expect(toastSuccessSpy).toHaveBeenCalledWith("Đã ngắt kết nối uni-work1@gmail.com"),
      );
      await waitFor(() => expect(screen.queryByText("uni-work1@gmail.com")).not.toBeInTheDocument());
      expect(
        screen.queryByText(
          "Bạn đã đăng nhập bằng tài khoản Google khác với tài khoản cần kết nối lại. Chọn đúng tài khoản uni-work2@gmail.com hoặc dùng \"Kết nối thêm tài khoản\".",
        ),
      ).not.toBeInTheDocument();
    });

    it("?connect=drive selects the Integrations tab, focuses the Drive row, removes the param with replace, and never opens a popup or calls start", async () => {
      openSpy.mockReturnValue(null);
      const nav = fakeNav("/acme/team/settings?connect=drive");

      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return Promise.resolve({
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          });
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return Promise.resolve({ connections: [] });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: true } }),
      );

      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SettingsPage />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          nav,
        ),
      );

      const integrationsTab = await screen.findByRole("tab", { name: "Tích hợp" });
      expect(integrationsTab).toHaveAttribute("aria-selected", "true");

      const driveRow = await screen.findByTestId("drive-integration-row");
      await waitFor(() => expect(document.activeElement).toBe(driveRow));
      expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=integrations");
      expect(nav.replace).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        expect.anything(),
      );
    });

    it("?connect=drive&tab=integrations focuses the Drive row, strips connect, and opens no popup or start call", async () => {
      openSpy.mockReturnValue(null);
      const nav = fakeNav("/acme/team/settings?connect=drive&tab=integrations");

      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return Promise.resolve({
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          });
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return Promise.resolve({ connections: [] });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: true } }),
      );

      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SettingsPage />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          nav,
        ),
      );

      const integrationsTab = await screen.findByRole("tab", { name: "Tích hợp" });
      expect(integrationsTab).toHaveAttribute("aria-selected", "true");

      const driveRow = await screen.findByTestId("drive-integration-row");
      await waitFor(() => expect(document.activeElement).toBe(driveRow));
      expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=integrations");
      expect(nav.replace).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        expect.anything(),
      );
    });

    it("?connect=drive when the Drive row is hidden (flag off) still strips connect from the URL and opens no popup or start call", async () => {
      openSpy.mockReturnValue(null);
      const nav = fakeNav("/acme/team/settings?connect=drive");

      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return Promise.resolve({
            flags: { drive_connector: false },
            rum_sample_rate: 0,
            drive: { available: true },
          });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: false } }),
      );

      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SettingsPage />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          nav,
        ),
      );

      const integrationsTab = await screen.findByRole("tab", { name: "Tích hợp" });
      expect(integrationsTab).toHaveAttribute("aria-selected", "true");
      await waitFor(() =>
        expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=integrations"),
      );
      await waitFor(() =>
        expect(requestMock).toHaveBeenCalledWith("/api/v1/config", expect.anything()),
      );
      await act(async () => {});
      expect(screen.queryByTestId("drive-integration-row")).not.toBeInTheDocument();
      expect(openSpy).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        expect.anything(),
      );
      expect(nav.replace).toHaveBeenCalledTimes(1);
    });

    it("?connect=drive still focuses the Drive row when the row mounts after connect has already been stripped from the URL", async () => {
      openSpy.mockReturnValue(null);
      const nav = fakeNav("/acme/team/settings?connect=drive");
      const { promise: configPromise, resolve: resolveConfig } = Promise.withResolvers<unknown>();

      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return configPromise;
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return Promise.resolve({ connections: [] });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: true } }),
      );

      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SettingsPage />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          nav,
        ),
      );

      await waitFor(() =>
        expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=integrations"),
      );
      // Force a second navigation notification after StatefulNavigation's subscription
      // effect has attached, so the tree re-renders with `connect` already absent
      // before `GET /api/v1/config` resolves and the Drive row mounts.
      act(() => {
        nav.replace("/acme/team/settings?tab=integrations");
      });
      expect(nav.searchParams.get("connect")).toBeNull();
      expect(screen.queryByTestId("drive-integration-row")).not.toBeInTheDocument();

      await act(async () => {
        resolveConfig({
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        });
      });

      const driveRow = await screen.findByTestId("drive-integration-row");
      await waitFor(() => expect(document.activeElement).toBe(driveRow));
      expect(openSpy).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        expect.anything(),
      );
    });

    it("?connect=drive&tab=profile strips connect, respects the explicit tab, and neither focuses the Drive row nor opens a popup", async () => {
      openSpy.mockReturnValue(null);
      const nav = fakeNav("/acme/team/settings?connect=drive&tab=profile");

      requestMock.mockImplementation((path: string) => {
        if (path === "/api/v1/config") {
          return Promise.resolve({
            flags: { drive_connector: true },
            rum_sample_rate: 0,
            drive: { available: true },
          });
        }
        if (path === "/api/v1/workspaces/ws1/drive-connections") {
          return Promise.resolve({ connections: [] });
        }
        if (path === "/api/v1/workspaces/ws1/email-hub/accounts") {
          return Promise.resolve({ accounts: [] });
        }
        return Promise.resolve({});
      });

      const service = new FeatureFlagService(
        new StaticProvider({ drive_connector: { default: true } }),
      );

      render(
        wrapWithNav(
          <FeatureFlagsProvider service={service}>
            <WorkspaceProvider workspace={workspace} user={user}>
              <SettingsPage />
            </WorkspaceProvider>
          </FeatureFlagsProvider>,
          nav,
        ),
      );

      const profileTab = await screen.findByRole("tab", { name: "Hồ sơ" });
      expect(profileTab).toHaveAttribute("aria-selected", "true");
      const integrationsTab = screen.getByRole("tab", { name: "Tích hợp" });
      expect(integrationsTab).toHaveAttribute("aria-selected", "false");

      await waitFor(() =>
        expect(nav.replace).toHaveBeenCalledWith("/acme/team/settings?tab=profile"),
      );
      expect(nav.replace).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("drive-integration-row")).not.toBeInTheDocument();
      expect(openSpy).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        expect.anything(),
      );
    });
  });
});
