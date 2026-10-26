import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveTaskFileCard as DriveTaskFileCardDTO } from "@uniwork/core/drive";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { createFakeDrivePickerAdapter } from "../../../integrations/drive-picker";
import { DRIVE_OAUTH_MESSAGE_TYPE } from "../../../integrations/use-drive-connect-popup";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { DriveTaskFileCard } from "./drive-task-file-card";

initI18n();

const user: User = {
  id: "u1",
  email: "mai@vietants.vn",
  display_name: "Mai",
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

const ACTIVE_CONN = {
  id: "dc_2",
  provider: "google",
  google_email: "mai@gmail.com",
  status: "active",
  needs_reconnect: false,
  linked_file_count: 1,
  connected_at: "2026-10-26T09:00:00Z",
  updated_at: "2026-10-26T09:00:00Z",
};

const LOST_CONN = {
  id: "dc_lost",
  provider: "google",
  google_email: "mai-lost@gmail.com",
  status: "needs_reconnect",
  needs_reconnect: true,
  linked_file_count: 1,
  connected_at: "2026-10-20T09:00:00Z",
  updated_at: "2026-10-26T09:00:00Z",
};

function makeCard(
  overrides: Partial<DriveTaskFileCardDTO> = {},
): DriveTaskFileCardDTO {
  return {
    id: "df_1",
    task_id: "t1",
    workspace_id: "ws1",
    external_file_id: "gdoc_1",
    name: "Kế hoạch ra mắt Q4",
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    sharing_state: "private",
    owner_display: "Lan",
    drive_modified_at: "2026-10-26T07:30:00Z",
    drive_modified_by_display: "Lan",
    connection_id: "dc_1",
    bound_account_email: "uni-work1@gmail.com",
    bound_connection_lost: false,
    bound_by_id: "u_minh",
    bound_by_name: "Minh",
    created_by: "u_minh",
    created_by_name: "Minh",
    linked_at: "2026-10-26T08:20:00Z",
    viewer_access: "granted",
    viewer_connection_id: "dc_1",
    viewer_account_email: "uni-work1@gmail.com",
    open_url:
      "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
    can_remove_from_task: true,
    can_propose: true,
    can_ask: true,
    tasks_created: { count: 0 },
    ...overrides,
  };
}

function renderCard(
  card: DriveTaskFileCardDTO,
  props: Partial<React.ComponentProps<typeof DriveTaskFileCard>> = {},
) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DriveTaskFileCard
          workspaceId="ws1"
          taskId="t1"
          card={card}
          {...props}
        />
      </WorkspaceProvider>,
    ),
  );
}

describe("DriveTaskFileCard", () => {
  beforeEach(async () => {
    await setLocale("vi");
    requestMock.mockReset();
    requestMock.mockImplementation((url: string) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [ACTIVE_CONN] });
      }
      return Promise.resolve({});
    });
  });

  it("renders granted viewer state with icon, metadata, Open on Google Drive link, and tasks_created line when count > 0", () => {
    const card = makeCard({
      tasks_created: {
        count: 4,
        last_created_at: "2026-10-26T09:58:00Z",
        last_created_by_name: "Minh",
      },
    });
    renderCard(card);

    expect(screen.getByRole("img", { name: "Google Docs" })).toBeInTheDocument();
    expect(screen.getByText("Kế hoạch ra mắt Q4")).toBeInTheDocument();
    expect(screen.getByText(/Drive: uni-work1@gmail\.com/)).toBeInTheDocument();
    expect(
      screen.getByTestId("task-drive-card-tasks-created-df_1"),
    ).toHaveTextContent(/Đã tạo 4 việc từ tài liệu/);

    const openLink = screen.getByRole("link", {
      name: /Mở trên Google Drive/i,
    });
    expect(openLink).toHaveAttribute(
      "href",
      "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
    );
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(openLink).toHaveAttribute("rel", "noopener noreferrer");

    // W4 does not render "Tạo việc từ tài liệu" or "Hỏi UNI" buttons itself.
    expect(
      screen.queryByRole("button", { name: /Tạo việc từ tài liệu|Hỏi UNI/i }),
    ).toBeNull();
  });

  it("confirms before unlinking from the task and awaits the server response before closing", async () => {
    const deleteGate = Promise.withResolvers<{ status: string }>();
    requestMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [ACTIVE_CONN] });
      }
      if (
        url === "/api/v1/tasks/t1/drive-files/df_1" &&
        opts?.method === "DELETE"
      ) {
        return deleteGate.promise;
      }
      return Promise.resolve({});
    });

    renderCard(makeCard({ can_remove_from_task: true }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Thêm thao tác cho Kế hoạch ra mắt Q4",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Bỏ liên kết" }));

    expect(
      await screen.findByText("Bỏ liên kết tệp khỏi việc này?"),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: "Bỏ liên kết" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/tasks/t1/drive-files/df_1",
        { method: "DELETE" },
      );
    });
    // Dialog stays open with aria-disabled while awaiting server.
    expect(
      screen.getByText("Bỏ liên kết tệp khỏi việc này?"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Đang bỏ liên kết/ }),
    ).toHaveAttribute("aria-disabled", "true");

    act(() => {
      deleteGate.resolve({ status: "ok" });
    });

    await waitFor(() => {
      expect(
        screen.queryByText("Bỏ liên kết tệp khỏi việc này?"),
      ).not.toBeInTheDocument();
    });
  });

  it("hides the more-actions menu when can_remove_from_task is false", () => {
    renderCard(makeCard({ can_remove_from_task: false }));
    expect(
      screen.queryByRole("button", {
        name: "Thêm thao tác cho Kế hoạch ra mắt Q4",
      }),
    ).toBeNull();
  });

  it("renders viewer_access = unknown and runs Picker setFileIds then POST .../access on 'Cho UniWork đọc tệp'", async () => {
    const adapter = createFakeDrivePickerAdapter({
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

    requestMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [ACTIVE_CONN] });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-connections/dc_2/picker-token" &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          access_token: "tok-mai",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-k",
          app_id: "app-1",
        });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-files/df_1/access" &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          file: {
            id: "df_1",
            organization_id: "o1",
            workspace_id: "ws1",
            external_file_id: "gdoc_1",
            name: "Kế hoạch ra mắt Q4",
            mime_type: "application/vnd.google-apps.document",
            web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
            open_url:
              "https://docs.google.com/document/d/gdoc_1/edit?authuser=mai%40gmail.com",
            connection_id: "dc_1",
            bound_account_email: "uni-work1@gmail.com",
            bound_by_id: "u_minh",
            created_by: "u_minh",
            created_at: "2026-10-26T08:15:00Z",
            viewer_access: "granted",
            viewer_connection_id: "dc_2",
            viewer_account_email: "mai@gmail.com",
          },
        });
      }
      return Promise.resolve({});
    });

    const card = makeCard({
      viewer_access: "unknown",
      viewer_connection_id: undefined,
      viewer_account_email: undefined,
      open_url: "https://docs.google.com/document/d/gdoc_1/edit",
    });

    renderCard(card, {
      pickerAdapter: adapter,
      actions: ({ blocked, blockedReason }) => (
        <button
          type="button"
          aria-disabled={blocked || undefined}
          title={blocked ? blockedReason : undefined}
        >
          Slot action
        </button>
      ),
    });

    expect(
      screen.getByTestId("task-drive-card-unknown-df_1"),
    ).toHaveTextContent("Bạn chưa cho UniWork đọc tệp này.");
    expect(
      screen.getByText(/Google Docs · Minh liên kết từ Google Drive/),
    ).toBeInTheDocument();

    const slotBtn = screen.getByRole("button", { name: "Slot action" });
    expect(slotBtn).toHaveAttribute("aria-disabled", "true");
    expect(slotBtn).toHaveAttribute("title", "Cần cho UniWork đọc tệp trước");

    fireEvent.click(
      screen.getByRole("button", { name: "Cho UniWork đọc tệp" }),
    );

    await waitFor(() => {
      expect(adapter.calls).toHaveLength(1);
    });
    expect(adapter.calls[0]?.fileIds).toEqual(["gdoc_1"]);
    expect(adapter.calls[0]?.multiselect).toBe(false);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files/df_1/access",
        { method: "POST", body: { connection_id: "dc_2" } },
      );
    });
  });

  it("opens the connect account step when a viewer without any connection clicks 'Cho UniWork đọc tệp'", async () => {
    requestMock.mockImplementation((url: string) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [] });
      }
      return Promise.resolve({});
    });

    renderCard(
      makeCard({
        viewer_access: "unknown",
        viewer_connection_id: undefined,
        viewer_account_email: undefined,
      }),
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Cho UniWork đọc tệp" }),
    );

    expect(
      await screen.findByRole("button", { name: "Kết nối Google Drive" }),
    ).toBeInTheDocument();
  });

  it("renders viewer_access = lost with notice and re-picks via Picker setFileIds", async () => {
    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    requestMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [ACTIVE_CONN] });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-connections/dc_2/picker-token" &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          access_token: "tok-mai",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-k",
          app_id: "app-1",
        });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-files/df_1/access" &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          file: {
            id: "df_1",
            organization_id: "o1",
            workspace_id: "ws1",
            external_file_id: "gdoc_1",
            name: "Kế hoạch ra mắt Q4",
            mime_type: "application/vnd.google-apps.document",
            web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
            open_url:
              "https://docs.google.com/document/d/gdoc_1/edit?authuser=mai%40gmail.com",
            connection_id: "dc_1",
            bound_account_email: "uni-work1@gmail.com",
            bound_by_id: "u_minh",
            created_by: "u_minh",
            created_at: "2026-10-26T08:15:00Z",
            viewer_access: "granted",
            viewer_connection_id: "dc_2",
            viewer_account_email: "mai@gmail.com",
          },
        });
      }
      return Promise.resolve({});
    });

    renderCard(
      makeCard({
        viewer_access: "lost",
        viewer_connection_id: "dc_2",
        viewer_account_email: "mai@gmail.com",
      }),
      { pickerAdapter: adapter },
    );

    expect(
      screen.getByTestId("task-drive-card-lost-df_1"),
    ).toHaveTextContent("Tài khoản mai@gmail.com không còn quyền với tệp này.");

    fireEvent.click(
      screen.getByRole("button", { name: "Cho UniWork đọc tệp" }),
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-files/df_1/access",
        { method: "POST", body: { connection_id: "dc_2" } },
      );
    });
  });

  it("renders viewer_access = connection_lost and runs the OAuth reconnect popup on 'Kết nối lại'", async () => {
    const fakePopup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
      location: { href: "about:blank" },
    };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(fakePopup as unknown as Window);

    requestMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [LOST_CONN] });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-connections/google/start" &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          authorization_url: "https://accounts.google.com/o/oauth2/auth?state=s1",
        });
      }
      return Promise.resolve({});
    });

    renderCard(
      makeCard({
        viewer_access: "connection_lost",
        viewer_connection_id: "dc_lost",
        viewer_account_email: "mai-lost@gmail.com",
      }),
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections",
      );
    });

    expect(
      screen.getByTestId("task-drive-card-connection-lost-df_1"),
    ).toHaveTextContent(
      "Kết nối Google Drive mai-lost@gmail.com đã hết hạn.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Kết nối lại" }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/drive-connections/google/start",
        {
          method: "POST",
          body: { reconnect_connection_id: "dc_lost" },
        },
      );
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: DRIVE_OAUTH_MESSAGE_TYPE,
            ok: true,
            code: "reconnected",
          },
        }),
      );
    });

    openSpy.mockRestore();
  });

  it("renders bound_connection_lost badge with warning-soft tokens and access_lost_at non-blocking notice", () => {
    renderCard(
      makeCard({
        bound_connection_lost: true,
        access_lost_at: "2026-10-26T09:15:00Z",
        viewer_access: "granted",
      }),
    );

    const badge = screen.getByText("Mất kết nối");
    expect(badge).toHaveClass(
      "bg-warning-soft",
      "text-warning-soft-foreground",
    );
    expect(
      screen.getByTestId("task-drive-card-bound-access-lost-df_1"),
    ).toHaveTextContent("Tài khoản gắn không còn quyền với tệp này.");
  });

  it("marks grant/repick and reconnect buttons aria-disabled and aria-busy while pending", async () => {
    const grantGate = Promise.withResolvers<{ file: Record<string, unknown> }>();
    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });

    requestMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [ACTIVE_CONN] });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-connections/dc_2/picker-token" &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          access_token: "tok-mai",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-k",
          app_id: "app-1",
        });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-files/df_1/access" &&
        opts?.method === "POST"
      ) {
        return grantGate.promise;
      }
      return Promise.resolve({});
    });

    const { unmount } = renderCard(
      makeCard({
        viewer_access: "lost",
        viewer_connection_id: "dc_2",
        viewer_account_email: "mai@gmail.com",
      }),
      { pickerAdapter: adapter },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Cho UniWork đọc tệp" }),
    );

    const busyGrantBtn = await screen.findByRole("button", {
      name: /Đang cấp quyền/,
    });
    expect(busyGrantBtn).toHaveAttribute("aria-disabled", "true");
    expect(busyGrantBtn).toHaveAttribute("aria-busy", "true");

    act(() => {
      grantGate.resolve({
        file: {
          id: "df_1",
          organization_id: "o1",
          workspace_id: "ws1",
          external_file_id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mime_type: "application/vnd.google-apps.document",
          web_view_link: "https://docs.google.com/document/d/gdoc_1/edit",
          open_url:
            "https://docs.google.com/document/d/gdoc_1/edit?authuser=mai%40gmail.com",
          connection_id: "dc_1",
          bound_account_email: "uni-work1@gmail.com",
          bound_by_id: "u_minh",
          created_by: "u_minh",
          created_at: "2026-10-26T08:15:00Z",
          viewer_access: "granted",
          viewer_connection_id: "dc_2",
          viewer_account_email: "mai@gmail.com",
        },
      });
    });
    unmount();

    const fakePopup = {
      closed: false,
      focus: vi.fn(),
      close: vi.fn(),
      location: { href: "about:blank" },
    };
    const openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(fakePopup as unknown as Window);

    const startGate = Promise.withResolvers<{ authorization_url: string }>();
    requestMock.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/api/v1/workspaces/ws1/drive-connections") {
        return Promise.resolve({ connections: [LOST_CONN] });
      }
      if (
        url === "/api/v1/workspaces/ws1/drive-connections/google/start" &&
        opts?.method === "POST"
      ) {
        return startGate.promise;
      }
      return Promise.resolve({});
    });

    renderCard(
      makeCard({
        viewer_access: "connection_lost",
        viewer_connection_id: "dc_lost",
        viewer_account_email: "mai-lost@gmail.com",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Kết nối lại" }));

    const busyReconnectBtn = await screen.findByRole("button", {
      name: /Đang kết nối/,
    });
    expect(busyReconnectBtn).toHaveAttribute("aria-disabled", "true");
    expect(busyReconnectBtn).toHaveAttribute("aria-busy", "true");

    openSpy.mockRestore();
  });
});
