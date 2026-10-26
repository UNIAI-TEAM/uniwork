import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { useAiPanelStore } from "@uniwork/core/ai";
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
import { DriveFileDetailView } from "./drive-file-detail-view";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const WS = "ws1";
const FILE_ID = "df1";
const CONFIG_URL = "/api/v1/config";
const DRIVE_CONNECTIONS_URL = `/api/v1/workspaces/${WS}/drive-connections`;
const DETAIL_URL = `/api/v1/workspaces/${WS}/drive-files/${FILE_ID}`;
const HISTORY_URL = `/api/v1/workspaces/${WS}/resources/drive_file/${FILE_ID}/history`;
const sessionUser = {
  id: "u1",
  email: "minh@example.com",
  display_name: "Minh Nguyễn",
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
];

function detailFile(over: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    organization_id: "org1",
    workspace_id: WS,
    external_file_id: "ext-1",
    name: "Kế hoạch ra mắt Q4",
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    web_view_link: "https://docs.google.com/document/d/ext-1/edit",
    open_url: "https://docs.google.com/document/d/ext-1/edit?authuser=uni-work1%40gmail.com",
    owner_display: "Lan",
    drive_modified_at: "2026-10-26T07:30:00Z",
    drive_modified_by_display: "Lan",
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
    used_in_count: 2,
    used_in_tasks: [
      { task_id: "t1", identifier: "UNI-1042", title: "Chuẩn bị kế hoạch ra mắt Q4", status: "todo" },
      { task_id: "t2", identifier: "UNI-1051", title: "Chốt phạm vi tính năng beta", status: "todo" },
    ],
    tasks_created: {
      count: 2,
      last_created_at: "2026-10-26T09:58:00Z",
      last_created_by_name: "Minh Nguyễn",
    },
    task_creations: [
      {
        proposal_id: "prop1",
        created_at: "2026-10-26T09:58:00Z",
        created_by_id: "u1",
        created_by_name: "Minh Nguyễn",
        tasks: [
          { task_id: "t2", identifier: "UNI-1051", title: "Chốt phạm vi tính năng beta", status: "todo" },
          { task_id: "t3", identifier: "UNI-1052", title: "Soạn FAQ cho CS", status: "todo" },
        ],
      },
    ],
    ...over,
  };
}

function defaultConfigResponse(driveAvailable = true, documentsFlag = true, driveFlag = true) {
  return {
    flags: { documents: documentsFlag, drive_connector: driveFlag },
    rum_sample_rate: 0,
    drive: { available: driveAvailable },
  };
}

const rawConnections = [
  {
    id: "conn1",
    provider: "google",
    google_email: "uni-work1@gmail.com",
    status: "active",
    needs_reconnect: false,
    linked_file_count: 3,
    connected_at: "2026-10-26T09:00:00Z",
  },
  {
    id: "conn2",
    provider: "google",
    google_email: "uni-work2@gmail.com",
    status: "active",
    needs_reconnect: false,
    linked_file_count: 2,
    connected_at: "2026-10-26T09:05:00Z",
  },
];

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

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => {
    if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
    if (path === DRIVE_CONNECTIONS_URL) return Promise.resolve({ connections: rawConnections });
    return Promise.resolve({ events: [] });
  });
  resetAuthStoreForTests();
  setSessionUser(sessionUser);
  useAiPanelStore.getState().reset();
});

describe("DriveFileDetailView (4.2)", () => {
  it("renders title, open_url link, properties, bound-by suffix when bound_by_id !== created_by, used-in tasks, task creations, and resource history", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            bound_account_email: "admin@gmail.com",
            bound_by_id: "u2",
            bound_by_name: "Lan Trần",
            created_by: "u1",
            created_by_name: "Minh Nguyễn",
          }),
        });
      }
      if (path === HISTORY_URL) {
        return Promise.resolve({
          events: [
            {
              id: "ev1",
              organization_id: "org1",
              workspace_id: WS,
              actor_kind: "human",
              actor_id: "u1",
              action: "drive_task_proposal.tasks_created",
              resource_type: "drive_file",
              resource_id: FILE_ID,
              changes: {},
              metadata: { count: 4 },
              correlation_id: "c1",
              occurred_at: "2026-10-26T09:58:00Z",
            },
            {
              id: "ev2",
              organization_id: "org1",
              workspace_id: WS,
              actor_kind: "human",
              actor_id: "u_unknown",
              action: "drive_file.linked",
              resource_type: "drive_file",
              resource_id: FILE_ID,
              changes: {},
              metadata: {},
              correlation_id: "c2",
              occurred_at: "2026-10-26T08:15:00Z",
            },
          ],
        });
      }
      return Promise.resolve({ members: [] });
    });

    render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} connections={connections} />));

    const heading = await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" });
    expect(heading).toHaveAttribute("title", "Kế hoạch ra mắt Q4");
    const leafSpan = screen.getAllByTitle("Kế hoạch ra mắt Q4").find((el) => el.tagName === "SPAN");
    expect(leafSpan).toBeTruthy();

    // Open in Google Drive links use open_url in a new tab with noopener noreferrer; header link is icon-only below sm with aria-label
    const openLinks = screen.getAllByRole("link", { name: t("driveLibrary.detail.open_on_drive") });
    expect(openLinks.length).toBeGreaterThan(0);
    expect(openLinks[0]).toHaveAttribute("aria-label", t("driveLibrary.detail.open_on_drive"));
    expect(within(openLinks[0]!).getByText(t("driveLibrary.detail.open_on_drive"))).toHaveClass("hidden", "sm:inline");
    expect(openLinks[0]!.parentElement).toHaveClass("basis-full", "sm:basis-auto");
    for (const link of openLinks) {
      expect(link).toHaveAttribute(
        "href",
        "https://docs.google.com/document/d/ext-1/edit?authuser=uni-work1%40gmail.com",
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    // Bound account + rebound suffix when bound_by_id !== created_by
    expect(screen.getByText("admin@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("(gắn lại bởi Lan Trần)")).toBeInTheDocument();

    // Viewer account + explainer
    expect(screen.getByText("uni-work1@gmail.com")).toBeInTheDocument();
    expect(screen.getByText(t("driveLibrary.detail.props.permissions_value"))).toBeInTheDocument();

    // Used in tasks
    expect(screen.getByText("Đang dùng ở · 2")).toBeInTheDocument();
    const taskLink = screen.getByRole("link", { name: "UNI-1042 · Chuẩn bị kế hoạch ra mắt Q4" });
    expect(taskLink).toHaveAttribute("href", "/acme/doi/tasks/t1");
    expect(taskLink).toHaveClass("pointer-coarse:min-h-11");

    // Tasks created groups (§8.8)
    expect(screen.getByText(t("driveLibrary.detail.tasks_created.title"))).toBeInTheDocument();
    expect(screen.getByText(/Minh Nguyễn · 2 việc/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "UNI-1052 · Soạn FAQ cho CS" })).toHaveAttribute(
      "href",
      "/acme/doi/tasks/t3",
    );

    // Activity in UniWork via useResourceHistory(wsId, "drive_file", id) including unknown actor fallback
    expect(await screen.findByText(/Bạn đã tạo 4 việc từ đề xuất của UNI/)).toBeInTheDocument();
    expect(screen.getByText(/Một thành viên đã liên kết tệp từ Google Drive/)).toBeInTheDocument();
  });

  it("renders the §7.4 block instead of 'Bạn mở bằng' when viewer_access is unknown, lost, or connection_lost", async () => {
    // 1. unknown
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            viewer_access: "unknown",
            viewer_account_email: undefined,
            viewer_connection_id: undefined,
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });

    const { unmount } = render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />));
    expect(await screen.findByText(t("driveLibrary.detail.viewer_access.unknown_lead"))).toBeInTheDocument();
    expect(screen.getByText(t("driveLibrary.detail.viewer_access.grant_button"))).toBeInTheDocument();
    expect(screen.queryByText(t("driveLibrary.detail.props.viewer_account"))).toBeNull();
    unmount();

    // 2. lost (with access_lost_at also set: does not duplicate bound_access_lost warning, W8-V1-06)
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            viewer_access: "lost",
            viewer_account_email: "mai@gmail.com",
            access_lost_at: "2026-10-26T09:00:00Z",
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });
    const lostRender = render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />));
    expect(
      await screen.findByText(t("driveLibrary.detail.viewer_access.lost_body", { email: "mai@gmail.com" })),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("driveLibrary.detail.props.bound_access_lost"))).toBeNull();
    lostRender.unmount();
    // 3. connection_lost
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            viewer_access: "connection_lost",
            viewer_account_email: "mai@gmail.com",
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });
    render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />));
    expect(
      await screen.findByText(
        t("driveLibrary.detail.viewer_access.connection_lost_body", { email: "mai@gmail.com" }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("driveLibrary.detail.viewer_access.reconnect_button"))).toBeInTheDocument();
  });

  it("shows 404 not-found state with 'Không tìm thấy tệp này hoặc bạn không có quyền xem.' and 'Về Google Drive của tôi'", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return Promise.reject(new ApiError("not found", "not_found", 404));
    });
    render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />));

    expect(await screen.findByText(t("driveLibrary.detail.not_found.title"))).toBeInTheDocument();
    const backLink = screen.getByRole("link", { name: t("driveLibrary.detail.not_found.back") });
    expect(backLink).toHaveAttribute("href", "/acme/doi/documents?view=drive");
  });

  it("confirms unlink with the §7.7 AlertDialog, moves focus into the dialog and back to trigger on cancel, calls DELETE without a second GET of detail, and navigates to ?view=drive", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL && opts?.method === "DELETE") {
        return Promise.resolve({ status: "ok" });
      }
      if (path === DETAIL_URL) {
        return Promise.resolve({ file: detailFile({ used_in_count: 5 }) });
      }
      return Promise.resolve({ events: [] });
    });

    const nav = fakeNav(`/acme/doi/documents/drive/${FILE_ID}`);
    render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />, true, nav));

    const unlinkBtn = await screen.findByRole("button", { name: t("driveLibrary.detail.unlink.button") });
    unlinkBtn.focus();
    fireEvent.click(unlinkBtn);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Bỏ liên kết khỏi 5 việc?")).toBeInTheDocument();
    expect(within(dialog).getByText(t("driveLibrary.detail.unlink.confirm_body"))).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Cancel returns focus to the trigger button
    fireEvent.click(within(dialog).getByRole("button", { name: t("driveLibrary.detail.unlink.keep") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(unlinkBtn));

    // Re-open and double-click confirm unlink -> only one DELETE fires and dialog closes on success (W8-R2-04)
    fireEvent.click(unlinkBtn);
    const dialogAgain = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialogAgain).getByRole("button", {
      name: t("driveLibrary.detail.unlink.confirm"),
    });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/acme/doi/documents?view=drive"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    const detailCalls = requestMock.mock.calls.filter(([path]) => path === DETAIL_URL);
    const getDetailCalls = detailCalls.filter(
      ([, opts]) =>
        !opts ||
        typeof opts !== "object" ||
        !("method" in opts) ||
        !opts.method ||
        opts.method === "GET",
    );
    const deleteDetailCalls = detailCalls.filter(
      ([, opts]) => Boolean(opts && typeof opts === "object" && "method" in opts && opts.method === "DELETE"),
    );
    expect(deleteDetailCalls).toHaveLength(1);
    expect(getDetailCalls).toHaveLength(1);
  });

  it("shows rebind when can_rebind is true and (access_lost_at or bound_connection_lost), opens W3 Picker with fileIds: [external_file_id] and linkOnPick: false, then calls POST .../rebind", async () => {
    // 1. Healthy bound connection -> no rebind button
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({ can_rebind: true, bound_connection_lost: false, access_lost_at: undefined }),
        });
      }
      return Promise.resolve({ events: [] });
    });
    const { unmount } = render(
      withFlag(
        <DriveFileDetailView wsId={WS} driveFileId={FILE_ID} connections={connections} />,
      ),
    );
    await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" });
    expect(screen.queryByRole("button", { name: t("driveLibrary.detail.rebind.button") })).toBeNull();
    unmount();

    // 2. access_lost_at set -> rebind button visible without needing an onRebind prop; picks with fileIds=[ext-1] and linkOnPick=false then posts /rebind
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "ext-1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
        },
      ],
    });
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({ connections: rawConnections });
      }
      if (
        path === `/api/v1/workspaces/${WS}/drive-connections/conn2/picker-token` &&
        opts?.method === "POST"
      ) {
        return Promise.resolve({
          access_token: "picker-tok-conn2",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-key",
          app_id: "app-id",
        });
      }
      if (path === `${DETAIL_URL}/rebind` && opts?.method === "POST") {
        return Promise.resolve({
          file: detailFile({
            connection_id: "conn2",
            bound_account_email: "uni-work2@gmail.com",
            bound_by_id: "u2",
            bound_by_name: "Lan Trần",
            access_lost_at: undefined,
          }),
        });
      }
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            can_rebind: true,
            access_lost_at: "2026-10-26T09:00:00Z",
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });

    render(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          connections={connections}
          pickerAdapter={fakeAdapter}
        />,
      ),
    );

    const rebindBtn = await screen.findByRole("button", { name: t("driveLibrary.detail.rebind.button") });
    fireEvent.click(rebindBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radiogroup", { name: t("driveLibrary.detail.rebind.account_label") })).toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: t("driveLibrary.detail.rebind.account_label") })).toBeNull();
    expect(within(dialog).getByRole("radio", { name: "uni-work2@gmail.com" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: t("driveLibrary.detail.rebind.submit") }));

    await waitFor(() => expect(fakeAdapter.calls).toHaveLength(1));
    expect(fakeAdapter.calls[0]?.token).toBe("picker-tok-conn2");
    expect(fakeAdapter.calls[0]?.fileIds).toEqual(["ext-1"]);
    expect(fakeAdapter.calls[0]?.multiselect).toBe(false);
    // linkOnPick: false -> never calls POST /drive-files
    expect(
      requestMock.mock.calls.some(
        ([path, opts]) =>
          path === `/api/v1/workspaces/${WS}/drive-files` &&
          (opts as { method?: string } | undefined)?.method === "POST",
      ),
    ).toBe(false);

    // Calls POST .../rebind with { connection_id: "conn2" }
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(
          ([path, opts]) =>
            path === `${DETAIL_URL}/rebind` &&
            (opts as { method?: string } | undefined)?.method === "POST" &&
            JSON.stringify((opts as { body?: unknown } | undefined)?.body) ===
              JSON.stringify({ connection_id: "conn2" }),
        ),
      ).toBe(true),
    );
  });

  it("does not POST /rebind when the user picks a different file, cancels, hits a Picker error, or when picker-token fails, and disables the trigger while busy (WIRE-R1-02, WIRE-R1-04, WIRE-R1-05)", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { promise: tokenGate, resolve: resolveToken } = Promise.withResolvers<unknown>();
    let tokenCalls = 0;
    let failToken = false;

    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({ connections: rawConnections });
      }
      if (path.endsWith("/picker-token") && opts?.method === "POST") {
        tokenCalls += 1;
        if (failToken) {
          return Promise.reject(new ApiError("boom", "internal", 500));
        }
        if (tokenCalls === 1) {
          return tokenGate;
        }
        return Promise.resolve({
          access_token: "picker-tok-conn2",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-key",
          app_id: "app-id",
        });
      }
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            can_rebind: true,
            access_lost_at: "2026-10-26T09:00:00Z",
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });

    // 1. Wrong file picked (id !== external_file_id) + trigger disabled/aria-busy while picker is pending
    const wrongFileAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "wrong-ext-id",
          name: "Tệp khác",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "private",
        },
      ],
    });
    const { rerender } = render(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          connections={connections}
          pickerAdapter={wrongFileAdapter}
        />,
      ),
    );

    const rebindBtn = await screen.findByRole("button", { name: t("driveLibrary.detail.rebind.button") });
    fireEvent.click(rebindBtn);
    const dialog1 = await screen.findByRole("dialog");
    fireEvent.click(within(dialog1).getByRole("button", { name: t("driveLibrary.detail.rebind.submit") }));

    // While picker-token is in flight, the trigger is disabled and aria-busy="true" (WIRE-R1-04)
    await waitFor(() => expect(rebindBtn).toHaveAttribute("aria-busy", "true"));
    expect(rebindBtn).toBeDisabled();

    resolveToken({
      access_token: "picker-tok-conn2",
      expires_at: "2026-10-26T12:00:00Z",
      developer_key: "dev-key",
      app_id: "app-id",
    });

    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(t("driveLibrary.detail.rebind.failed")),
    );
    expect(rebindBtn).not.toBeDisabled();
    expect(rebindBtn).not.toHaveAttribute("aria-busy");

    // 2. Adapter cancelled -> zero /rebind calls, trigger returns to idle
    toastErrorSpy.mockClear();
    const cancelledAdapter = createFakeDrivePickerAdapter({ status: "cancelled" });
    rerender(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          connections={connections}
          pickerAdapter={cancelledAdapter}
        />,
      ),
    );
    fireEvent.click(rebindBtn);
    const dialog2 = await screen.findByRole("dialog");
    fireEvent.click(within(dialog2).getByRole("button", { name: t("driveLibrary.detail.rebind.submit") }));
    await waitFor(() => expect(cancelledAdapter.calls).toHaveLength(1));
    expect(rebindBtn).not.toBeDisabled();
    expect(rebindBtn).not.toHaveAttribute("aria-busy");

    // 3. Adapter error -> zero /rebind calls, trigger returns to idle
    const errorAdapter = createFakeDrivePickerAdapter({ status: "error", reason: "script_load_failed" });
    rerender(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          connections={connections}
          pickerAdapter={errorAdapter}
        />,
      ),
    );
    fireEvent.click(rebindBtn);
    const dialog3 = await screen.findByRole("dialog");
    fireEvent.click(within(dialog3).getByRole("button", { name: t("driveLibrary.detail.rebind.submit") }));
    await waitFor(() => expect(errorAdapter.calls).toHaveLength(1));
    expect(rebindBtn).not.toBeDisabled();
    expect(rebindBtn).not.toHaveAttribute("aria-busy");

    // 4. picker-token failure -> zero /rebind calls, trigger returns to idle
    failToken = true;
    fireEvent.click(rebindBtn);
    const dialog4 = await screen.findByRole("dialog");
    fireEvent.click(within(dialog4).getByRole("button", { name: t("driveLibrary.detail.rebind.submit") }));
    await waitFor(() => expect(tokenCalls).toBe(4));
    await waitFor(() => expect(rebindBtn).not.toBeDisabled());
    expect(rebindBtn).not.toHaveAttribute("aria-busy");

    // Across all 4 error/cancel/mismatch paths, POST .../rebind was never called
    expect(
      requestMock.mock.calls.filter(([path]) => path === `${DETAIL_URL}/rebind`),
    ).toHaveLength(0);
    toastErrorSpy.mockRestore();
  });

  it("hides action buttons for a read-only/guest viewer when can_* flags are false, and strips ?propose=1 / ?ask=1 (§7.11)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            can_unlink: false,
            can_rebind: false,
            can_propose: false,
            can_ask: false,
            bound_connection_lost: true,
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });

    const onPropose = vi.fn();
    const onAsk = vi.fn();
    const nav = fakeNav(`/acme/doi/documents/drive/${FILE_ID}?propose=1&ask=1`);

    render(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          connections={connections}
          onPropose={onPropose}
          onAsk={onAsk}
        />,
        true,
        nav,
      ),
    );

    await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" });
    expect(screen.queryByRole("button", { name: t("driveLibrary.detail.unlink.button") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("driveLibrary.detail.rebind.button") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("driveLibrary.detail.propose_tasks") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("driveLibrary.detail.ask_uni") })).toBeNull();

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/acme/doi/documents/drive/${FILE_ID}`));
    expect(onPropose).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("shows loading skeleton and retryable error state on 4.2 (§7.10), and invokes onPropose/onAsk when ?propose=1 or ?ask=1 is passed with can_* true (§7.11)", async () => {
    // 1. Loading skeleton
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      return new Promise(() => {});
    });
    const { unmount } = render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />));
    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    unmount();

    // 2. Error + retry + ?propose=1 & ?ask=1 with can_propose & can_ask = true
    let calls = 0;
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        calls += 1;
        if (calls <= 2) return Promise.reject(new ApiError("boom", "internal", 500));
        return Promise.resolve({ file: detailFile({ can_propose: true, can_ask: true }) });
      }
      return Promise.resolve({ events: [] });
    });

    const onPropose = vi.fn();
    const onAsk = vi.fn();
    const nav = fakeNav(`/acme/doi/documents/drive/${FILE_ID}?propose=1&ask=1`);

    render(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          onPropose={onPropose}
          onAsk={onAsk}
        />,
        true,
        nav,
      ),
    );

    expect(await screen.findByText(t("driveLibrary.detail.error.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.detail.error.retry") }));

    expect(await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" })).toBeInTheDocument();
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith(`/acme/doi/documents/drive/${FILE_ID}`);
  });

  it("uses localized failure toasts on non-ApiError unlink/rebind failures and never falls back to bound_account_email when viewer_account_email is absent", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const fakeAdapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [{ id: "ext-1", name: "Kế hoạch ra mắt Q4", mimeType: "application/vnd.google-apps.document" }],
    });
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DRIVE_CONNECTIONS_URL) {
        return Promise.resolve({ connections: rawConnections });
      }
      if (path.endsWith("/picker-token") && opts?.method === "POST") {
        return Promise.resolve({
          access_token: "picker-tok",
          expires_at: "2026-10-26T12:00:00Z",
          developer_key: "dev-key",
          app_id: "app-id",
        });
      }
      if (path === DETAIL_URL && opts?.method === "DELETE") {
        return Promise.reject(new Error("internal English transport error"));
      }
      if (path === `${DETAIL_URL}/rebind` && opts?.method === "POST") {
        return Promise.resolve({ file: null });
      }
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            bound_account_email: "other-member@gmail.com",
            viewer_account_email: undefined,
            viewer_access: "granted",
            can_rebind: true,
            access_lost_at: "2026-10-26T09:00:00Z",
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });

    render(
      withFlag(
        <DriveFileDetailView
          wsId={WS}
          driveFileId={FILE_ID}
          connections={connections}
          pickerAdapter={fakeAdapter}
        />,
      ),
    );
    await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" });
    // Viewer account shows "—", not other-member@gmail.com twice, and explainer uses no-account variant
    expect(screen.getAllByText("other-member@gmail.com")).toHaveLength(1);
    expect(screen.getByText(t("driveLibrary.list.no_account_value"))).toBeInTheDocument();
    expect(screen.getByText(t("driveLibrary.detail.explainer_no_account"))).toBeInTheDocument();

    // Unlink failure with plain Error uses localized unlink.failed
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.detail.unlink.button") }));
    const alertDialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(alertDialog).getByRole("button", { name: t("driveLibrary.detail.unlink.confirm") }));
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith(t("driveLibrary.detail.unlink.failed")));
    fireEvent.click(within(alertDialog).getByRole("button", { name: t("driveLibrary.detail.unlink.keep") }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    // Rebind failure with malformed 200 uses localized rebind.failed
    toastErrorSpy.mockClear();
    fireEvent.click(screen.getByRole("button", { name: t("driveLibrary.detail.rebind.button") }));
    const rebindDialog = await screen.findByRole("dialog");
    fireEvent.click(within(rebindDialog).getByRole("button", { name: t("driveLibrary.detail.rebind.submit") }));
    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith(t("driveLibrary.detail.rebind.failed")));
    toastErrorSpy.mockRestore();
  });

  it("renders Hỏi UNI aria-disabled with access_required_hint when viewer_access !== 'granted' and seam is present (§7.4)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            viewer_access: "unknown",
            viewer_account_email: undefined,
            can_ask: false,
          }),
        });
      }
      return Promise.resolve({ events: [] });
    });

    const onAsk = vi.fn();
    render(withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} onAsk={onAsk} />));

    const askBtn = await screen.findByRole("button", { name: t("driveLibrary.detail.ask_uni") });
    expect(askBtn).toHaveAttribute("aria-disabled", "true");
    const hintId = askBtn.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId!);
    expect(hint).toHaveTextContent(t("driveLibrary.detail.access_required_hint"));
    expect(askBtn.parentElement).toHaveClass("basis-full", "sm:basis-auto");
    expect(hint).toHaveClass("basis-full", "order-last");
    fireEvent.click(askBtn);
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("wires default useAskUniOpener without bound_account_email fallback and waits for capabilities before stripping ?ask=1", async () => {
    const { promise: capsPromise, resolve: resolveCaps } = Promise.withResolvers<unknown>();
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({
            can_ask: true,
            viewer_access: "granted",
            viewer_account_email: undefined,
            bound_account_email: "other-member@gmail.com",
          }),
        });
      }
      if (path.endsWith("/ai/capabilities")) {
        return capsPromise;
      }
      return Promise.resolve({ events: [] });
    });

    const nav = fakeNav(`/acme/doi/documents/drive/${FILE_ID}?ask=1`);
    const service = new FeatureFlagService(
      new StaticProvider({
        documents: { default: true },
        drive_connector: { default: true },
        ask_uni_stream: { default: true },
      }),
    );
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={sessionUser}>
          <FeatureFlagsProvider service={service}>
            <DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>,
        nav,
      ),
    );

    await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" });
    // While capabilities are still pending, ?ask=1 is not stripped yet
    expect(nav.replace).not.toHaveBeenCalled();
    expect(useAiPanelStore.getState().open).toBe(false);

    resolveCaps({ enabled: true, ask_uni: true });
    await screen.findByRole("button", { name: t("driveLibrary.detail.ask_uni") });
    await waitFor(() => expect(useAiPanelStore.getState().open).toBe(true));
    expect(useAiPanelStore.getState().pendingFocus).toEqual({
      kind: "drive_file",
      id: FILE_ID,
      label: "Kế hoạch ra mắt Q4",
      accountEmail: undefined,
      openUrl: "https://docs.google.com/document/d/ext-1/edit?authuser=uni-work1%40gmail.com",
    });
    expect(nav.replace).toHaveBeenCalledWith(`/acme/doi/documents/drive/${FILE_ID}`);
  });

  it("invokes onPropose at most once when ?propose=1&ask=1 is loaded while capabilities are pending", async () => {
    const { promise: capsPromise, resolve: resolveCaps } = Promise.withResolvers<unknown>();
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true));
      if (path === DETAIL_URL) {
        return Promise.resolve({
          file: detailFile({ can_propose: true, can_ask: true, viewer_access: "granted" }),
        });
      }
      if (path.endsWith("/ai/capabilities")) {
        return capsPromise;
      }
      return Promise.resolve({ events: [] });
    });

    const onPropose = vi.fn();
    const baseNav = fakeNav(`/acme/doi/documents/drive/${FILE_ID}?propose=1&ask=1`);
    // Simulate a slow replace that has not yet updated searchParams when capabilities resolve
    const nav = {
      ...baseNav,
      replace: vi.fn(),
    };
    const service = new FeatureFlagService(
      new StaticProvider({
        documents: { default: true },
        drive_connector: { default: true },
        ask_uni_stream: { default: true },
      }),
    );
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={sessionUser}>
          <FeatureFlagsProvider service={service}>
            <DriveFileDetailView wsId={WS} driveFileId={FILE_ID} onPropose={onPropose} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>,
        nav,
      ),
    );

    await screen.findByRole("heading", { level: 1, name: "Kế hoạch ra mắt Q4" });
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));

    resolveCaps({ enabled: true, ask_uni: true });
    await waitFor(() => expect(useAiPanelStore.getState().open).toBe(true));
    expect(onPropose).toHaveBeenCalledTimes(1);
  });

  it("enforces the W8-R1-05 gate on 4.2 (waits for config without flashing off, hides screen when flag or drive.available is off)", async () => {
    // 1. Config loading -> renders skeleton, does not flash off state or fetch detail yet
    const { promise: configPromise, resolve: resolveConfig } = Promise.withResolvers<unknown>();
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return configPromise;
      return Promise.resolve({ file: detailFile() });
    });

    const { unmount } = render(
      withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />, true, fakeNav(), true),
    );
    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(screen.queryByText(t("driveLibrary.detail.not_found.title"))).toBeNull();
    expect(requestMock.mock.calls.filter(([p]) => p === DETAIL_URL)).toHaveLength(0);

    // Resolve config with drive.available: false -> renders 404 CollectionPageState without fetching detail
    resolveConfig(defaultConfigResponse(false));
    expect(await screen.findByText(t("driveLibrary.detail.not_found.title"))).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: t("driveLibrary.detail.not_found.back") }),
    ).toHaveAttribute("href", "/acme/doi/documents?view=drive");
    expect(requestMock.mock.calls.filter(([p]) => p === DETAIL_URL)).toHaveLength(0);
    unmount();

    // 2. drive_connector flag off -> renders 404 CollectionPageState
    requestMock.mockImplementation((path: string) => {
      if (path === CONFIG_URL) return Promise.resolve(defaultConfigResponse(true, true, false));
      return Promise.resolve({ file: detailFile() });
    });
    render(
      withFlag(<DriveFileDetailView wsId={WS} driveFileId={FILE_ID} />, true, fakeNav(), false),
    );
    expect(await screen.findByText(t("driveLibrary.detail.not_found.title"))).toBeInTheDocument();
    expect(requestMock.mock.calls.filter(([p]) => p === DETAIL_URL)).toHaveLength(0);
  });
});
