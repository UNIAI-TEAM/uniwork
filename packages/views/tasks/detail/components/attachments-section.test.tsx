import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import type { DriveTaskFileCard } from "@uniwork/core/drive";
import {
  FeatureFlagService,
  FeatureFlagsProvider,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { createFakeDrivePickerAdapter } from "../../../integrations/drive-picker";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailAttachmentsSection } from "./attachments-section";

const deleteMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const uploadMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "a_new",
    workspace_id: "w1",
    task_id: "t1",
    filename: "uploaded.pdf",
    url: "/api/v1/attachments/a_new/content",
    download_url: "/api/v1/attachments/a_new/download",
    content_type: "application/pdf",
    size_bytes: 100,
    created_at: "2026-09-01T00:00:00Z",
  }),
);
const linkDriveFilesMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    results: [
      {
        external_file_id: "gdoc_1",
        outcome: "linked",
        file: {
          id: "df_1",
          task_id: "t1",
          workspace_id: "w1",
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
          connection_id: "dc_1",
          bound_account_email: "uni-work1@gmail.com",
          bound_connection_lost: false,
          bound_by_id: "u1",
          bound_by_name: "Minh",
          created_by_id: "u1",
          created_by_name: "Minh",
          can_remove_from_task: true,
          tasks_created: { count: 0 },
          created_at: "2026-10-26T10:00:00Z",
          updated_at: "2026-10-26T10:00:00Z",
        },
      },
    ],
  }),
);

const attachmentsState = vi.hoisted(() => ({
  data: [] as Array<{
    id: string;
    workspace_id: string;
    task_id: string;
    filename: string;
    url: string;
    download_url: string;
    content_type: string;
    size_bytes: number;
    created_at: string;
  }>,
  isError: false,
  isLoading: false,
}));

const driveState = vi.hoisted(() => ({
  files: [] as DriveTaskFileCard[],
  isError: false,
  isLoading: false,
  connections: [
    {
      id: "dc_1",
      provider: "google",
      google_email: "uni-work1@gmail.com",
      status: "active",
      needs_reconnect: false,
      linked_file_count: 1,
      connected_at: "2026-10-26T09:00:00Z",
      updated_at: "2026-10-26T09:00:00Z",
    },
  ],
}));

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTaskAttachments: () => ({
      data: attachmentsState.isError ? undefined : attachmentsState.data,
      isLoading: attachmentsState.isLoading,
      isError: attachmentsState.isError,
    }),
    useDeleteAttachment: () => ({
      mutateAsync: deleteMutateAsync,
      isPending: false,
    }),
    useUploadTaskAttachment: () => ({
      mutateAsync: uploadMutateAsync,
      isPending: false,
    }),
  };
});

const mockUseTaskDriveFiles = vi.hoisted(() =>
  vi.fn(
    (_wsId: string, _taskId: string, _opts?: { enabled?: boolean }) => ({
      data: driveState.isError ? undefined : driveState.files,
      isLoading: driveState.isLoading,
      isError: driveState.isError,
    }),
  ),
);

vi.mock("@uniwork/core/drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/drive")>();
  return {
    ...actual,
    useTaskDriveFiles: mockUseTaskDriveFiles,
    useDriveConnections: () => ({
      data: { connections: driveState.connections },
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({
        data: { connections: driveState.connections },
      }),
    }),
    useDrivePickerToken: () => ({
      mutateAsync: vi.fn().mockResolvedValue({
        access_token: "picker-tok",
        expires_at: "2026-10-26T10:30:00Z",
        developer_key: "dev-key",
        app_id: "123456",
        google_email: "uni-work1@gmail.com",
      }),
      isPending: false,
    }),
    useLinkDriveFiles: () => ({
      mutateAsync: linkDriveFilesMutateAsync,
      isPending: false,
    }),
  };
});

const publicConfigState = vi.hoisted(() => ({
  data: {
    flags: {} as Record<string, boolean>,
    rum_sample_rate: 0,
    work_management_capabilities: {
      "tasks.attachments": {
        status: "available" as "available" | "unavailable",
        reason_code: undefined as string | undefined,
        explanation_key: undefined as string | undefined,
      },
    },
    drive: {
      available: false,
    },
  },
}));

vi.mock("@uniwork/core/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/feature-flags")>();
  return {
    ...actual,
    usePublicConfig: () => ({ data: publicConfigState.data }),
  };
});

vi.mock("@uniwork/core/api/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/api/http")>();
  return {
    ...actual,
    requestBlob: vi.fn().mockResolvedValue(new Blob(["x"], { type: "image/png" })),
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

const sampleDriveCard: DriveTaskFileCard = {
  id: "df_1",
  task_id: "t1",
  workspace_id: "w1",
  external_file_id: "gdoc_1",
  name: "Kế hoạch ra mắt Q4",
  mime_type: "application/vnd.google-apps.document",
  icon_kind: "google_doc",
  sharing_state: "private",
  owner_display: "Minh",
  open_url:
    "https://docs.google.com/document/d/gdoc_1/edit?authuser=uni-work1%40gmail.com",
  viewer_access: "granted",
  viewer_connection_id: "dc_1",
  viewer_account_email: "uni-work1@gmail.com",
  connection_id: "dc_1",
  bound_account_email: "uni-work1@gmail.com",
  bound_connection_lost: false,
  bound_by_id: "u1",
  bound_by_name: "Minh",
  created_by: "u1",
  created_by_name: "Minh",
  linked_at: "2026-10-26T10:00:00Z",
  can_remove_from_task: true,
  can_propose: true,
  can_ask: true,
  tasks_created: { count: 0 },
};

function shell(ui: React.ReactElement, opts?: { driveFlag?: boolean }) {
  const driveFlag =
    opts?.driveFlag ?? Boolean(publicConfigState.data.flags.drive_connector);
  const service = new FeatureFlagService(
    new StaticProvider({
      drive_connector: { default: driveFlag },
    }),
  );
  return wrapWithNav(
    <FeatureFlagsProvider service={service}>
      <WorkspaceProvider workspace={workspace} user={me}>
        {ui}
      </WorkspaceProvider>
    </FeatureFlagsProvider>,
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  deleteMutateAsync.mockClear();
  uploadMutateAsync.mockClear();
  linkDriveFilesMutateAsync.mockClear();
  mockUseTaskDriveFiles.mockClear();
  attachmentsState.data = [];
  attachmentsState.isError = false;
  attachmentsState.isLoading = false;
  driveState.files = [];
  driveState.isError = false;
  driveState.isLoading = false;
  driveState.connections = [
    {
      id: "dc_1",
      provider: "google",
      google_email: "uni-work1@gmail.com",
      status: "active",
      needs_reconnect: false,
      linked_file_count: 1,
      connected_at: "2026-10-26T09:00:00Z",
      updated_at: "2026-10-26T09:00:00Z",
    },
  ];
  publicConfigState.data = {
    flags: {},
    rum_sample_rate: 0,
    work_management_capabilities: {
      "tasks.attachments": {
        status: "available",
        reason_code: undefined,
        explanation_key: undefined,
      },
    },
    drive: {
      available: false,
    },
  };
});

describe("TaskDetailAttachmentsSection", () => {
  it("renders the Attachments section with empty state when the viewer can add files", () => {
    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(
      screen.getByRole("region", { name: /đính kèm|attachments/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Thêm tệp" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-attachments-empty")).toHaveTextContent(
      "Chưa có tệp đính kèm. Thả tệp vào đây hoặc dùng Thêm tệp.",
    );
  });

  it("renders nothing when there are no files and the viewer cannot add (read-only or both upload and Drive unavailable)", () => {
    const { unmount } = render(
      shell(
        <TaskDetailAttachmentsSection
          workspaceId="w1"
          taskId="t1"
          canEdit={false}
        />,
      ),
    );
    expect(
      screen.queryByRole("region", { name: /đính kèm|attachments/i }),
    ).toBeNull();
    expect(screen.queryByTestId("task-attachments-empty")).toBeNull();
    unmount();

    publicConfigState.data.work_management_capabilities["tasks.attachments"] = {
      status: "unavailable",
      reason_code: "surface_not_ready",
      explanation_key: "capabilities.surface_not_ready",
    };
    publicConfigState.data.drive = { available: false };

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />, {
        driveFlag: false,
      }),
    );
    expect(
      screen.queryByRole("region", { name: /đính kèm|attachments/i }),
    ).toBeNull();
    expect(screen.queryByTestId("task-attachments-empty")).toBeNull();
  });

  it("renders a row skeleton during initial load when canAdd is true, and returns null without flashing when !canAdd and no content", () => {
    attachmentsState.isLoading = true;

    const { unmount } = render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByTestId("task-attachments-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("task-attachments-empty")).toBeNull();
    unmount();

    render(
      shell(
        <TaskDetailAttachmentsSection
          workspaceId="w1"
          taskId="t1"
          canEdit={false}
        />,
      ),
    );
    expect(
      screen.queryByRole("region", { name: /đính kèm|attachments/i }),
    ).toBeNull();
    expect(screen.queryByTestId("task-attachments-loading")).toBeNull();
  });

  it("renders images inline and other files as attachment cards", () => {
    attachmentsState.data = [
      {
        id: "a1",
        workspace_id: "w1",
        task_id: "t1",
        filename: "photo.png",
        url: "/api/v1/attachments/a1/content",
        download_url: "/api/v1/attachments/a1/download",
        content_type: "image/png",
        size_bytes: 10,
        created_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "a2",
        workspace_id: "w1",
        task_id: "t1",
        filename: "notes.docx",
        url: "/api/v1/attachments/a2/content",
        download_url: "/api/v1/attachments/a2/download",
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: 20,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(
      screen.getByRole("img", { name: "photo.png" }),
    ).toBeInTheDocument();
    expect(screen.getByText("notes.docx")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /xem ảnh|view image/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-attachments-empty")).toBeNull();
  });

  it("does not repeat an attachment referenced by the description", () => {
    attachmentsState.data = [
      {
        id: "a1",
        workspace_id: "w1",
        task_id: "t1",
        filename: "photo.png",
        url: "/api/v1/attachments/a1/content",
        download_url: "/api/v1/attachments/a1/download",
        content_type: "image/png",
        size_bytes: 10,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];

    render(
      shell(
        <TaskDetailAttachmentsSection
          workspaceId="w1"
          taskId="t1"
          content="![photo](/api/v1/attachments/a1/download)"
        />,
      ),
    );

    expect(screen.queryByRole("img", { name: "photo.png" })).toBeNull();
    expect(screen.getByTestId("task-attachments-empty")).toBeInTheDocument();
  });

  it("keeps existing files visible but hides destructive and add actions when unavailable", () => {
    attachmentsState.data = [
      {
        id: "a2",
        workspace_id: "w1",
        task_id: "t1",
        filename: "notes.docx",
        url: "/api/v1/attachments/a2/content",
        download_url: "/api/v1/attachments/a2/download",
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: 20,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    publicConfigState.data = {
      flags: {},
      rum_sample_rate: 0,
      work_management_capabilities: {
        "tasks.attachments": {
          status: "unavailable",
          reason_code: "surface_not_ready",
          explanation_key: "capabilities.surface_not_ready",
        },
      },
      drive: {
        available: false,
      },
    };

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByText("notes.docx")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /gỡ|xóa|remove|delete/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Thêm tệp" })).toBeNull();
  });

  it("confirms before deleting a standalone attachment", async () => {
    attachmentsState.data = [
      {
        id: "a2",
        workspace_id: "w1",
        task_id: "t1",
        filename: "notes.docx",
        url: "/api/v1/attachments/a2/content",
        download_url: "/api/v1/attachments/a2/download",
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: 20,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /gỡ tệp đính kèm|remove attachment/i }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /xóa|delete/i }),
    );

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith("a2");
    });
  });

  it("renders uploaded attachments alongside Drive cards and keeps each side visible if the other fails", () => {
    publicConfigState.data.flags = { drive_connector: true };
    publicConfigState.data.drive = { available: true };
    attachmentsState.data = [
      {
        id: "a2",
        workspace_id: "w1",
        task_id: "t1",
        filename: "notes.docx",
        url: "/api/v1/attachments/a2/content",
        download_url: "/api/v1/attachments/a2/download",
        content_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: 20,
        created_at: "2026-09-01T00:00:00Z",
      },
    ];
    driveState.files = [sampleDriveCard];

    const { rerender } = render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByText("Kế hoạch ra mắt Q4")).toBeInTheDocument();
    expect(screen.getByText("notes.docx")).toBeInTheDocument();

    // If Drive query fails, uploaded attachment remains visible
    driveState.isError = true;
    rerender(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );
    expect(screen.getByText("notes.docx")).toBeInTheDocument();

    // If attachments query fails, Drive card remains visible
    driveState.isError = false;
    attachmentsState.isError = true;
    rerender(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );
    expect(screen.getByText("Kế hoạch ra mắt Q4")).toBeInTheDocument();
  });

  it("opens 'Thêm tệp' menu with 'Tải tệp lên' and 'Từ Google Drive' when Drive is available", async () => {
    publicConfigState.data.flags = { drive_connector: true };
    publicConfigState.data.drive = { available: true };

    const adapter = createFakeDrivePickerAdapter({
      status: "picked",
      files: [
        {
          id: "gdoc_1",
          name: "Kế hoạch ra mắt Q4",
          mimeType: "application/vnd.google-apps.document",
          sharingState: "shared",
        },
      ],
    });

    render(
      shell(
        <TaskDetailAttachmentsSection
          workspaceId="w1"
          taskId="t1"
          pickerAdapter={adapter}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm tệp" }));

    expect(
      await screen.findByRole("menuitem", { name: "Tải tệp lên" }),
    ).toBeInTheDocument();
    const fromDriveItem = await screen.findByRole("menuitem", {
      name: /Từ Google Drive/,
    });
    expect(fromDriveItem).not.toHaveTextContent("tài khoản đã kết nối");
    fireEvent.click(fromDriveItem);

    await waitFor(() => {
      expect(linkDriveFilesMutateAsync).toHaveBeenCalledWith({
        connection_id: "dc_1",
        external_file_ids: ["gdoc_1"],
        task_id: "t1",
      });
    });
  });

  it("shows the connected account count only when > 1 and keeps the Drive menu item when no account is connected so the viewer can connect", async () => {
    publicConfigState.data.flags = { drive_connector: true };
    publicConfigState.data.drive = { available: true };
    driveState.connections = [
      {
        id: "dc_1",
        provider: "google",
        google_email: "uni-work1@gmail.com",
        status: "active",
        needs_reconnect: false,
        linked_file_count: 1,
        connected_at: "2026-10-26T09:00:00Z",
        updated_at: "2026-10-26T09:00:00Z",
      },
      {
        id: "dc_2",
        provider: "google",
        google_email: "work2@vietants.vn",
        status: "active",
        needs_reconnect: false,
        linked_file_count: 2,
        connected_at: "2026-10-26T09:10:00Z",
        updated_at: "2026-10-26T09:10:00Z",
      },
    ];

    const { unmount } = render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />, {
        driveFlag: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm tệp" }));
    const fromDriveWithTwo = await screen.findByRole("menuitem", {
      name: /Từ Google Drive/,
    });
    expect(fromDriveWithTwo).toHaveTextContent("2 tài khoản đã kết nối");
    unmount();

    // With 0 connections and tasks.attachments unavailable (Drive-only viewer),
    // the menu still appears and clicking "Từ Google Drive" opens the connect dialog.
    publicConfigState.data.work_management_capabilities["tasks.attachments"] = {
      status: "unavailable",
      reason_code: "surface_not_ready",
      explanation_key: "capabilities.surface_not_ready",
    };
    driveState.connections = [];

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />, {
        driveFlag: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm tệp" }));
    expect(
      screen.queryByRole("menuitem", { name: "Tải tệp lên" }),
    ).toBeNull();
    const fromDriveNoConn = await screen.findByRole("menuitem", {
      name: /Từ Google Drive/,
    });
    expect(fromDriveNoConn).not.toHaveTextContent("tài khoản đã kết nối");
    fireEvent.click(fromDriveNoConn);

    expect(
      await screen.findByRole("button", { name: "Kết nối Google Drive" }),
    ).toBeInTheDocument();
  });

  it("gates useTaskDriveFiles on useDriveAvailable()", () => {
    const { unmount } = render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />, {
        driveFlag: false,
      }),
    );
    expect(mockUseTaskDriveFiles).toHaveBeenCalledWith("w1", "t1", {
      enabled: false,
    });
    unmount();

    mockUseTaskDriveFiles.mockClear();
    publicConfigState.data.drive = { available: true };
    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />, {
        driveFlag: true,
      }),
    );
    expect(mockUseTaskDriveFiles).toHaveBeenCalledWith("w1", "t1", {
      enabled: true,
    });
  });
});
