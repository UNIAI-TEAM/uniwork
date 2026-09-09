import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailAttachmentsSection } from "./attachments-section";

const uploadMutateAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    id: "a-new",
    workspace_id: "w1",
    task_id: "t1",
    filename: "shot.png",
    url: "/api/v1/attachments/a-new/content",
    download_url: "/api/v1/attachments/a-new/download",
    content_type: "image/png",
    size_bytes: 12,
    created_at: "2026-09-09T00:00:00Z",
  }),
);
const deleteMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const tryOpenPreview = vi.hoisted(() => vi.fn(() => true));

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
}));

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useTaskAttachments: () => ({
      data: attachmentsState.data,
      isLoading: false,
      isError: false,
    }),
    useUploadTaskAttachment: () => ({
      mutateAsync: uploadMutateAsync,
      isPending: false,
    }),
    useDeleteAttachment: () => ({
      mutateAsync: deleteMutateAsync,
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
  },
}));

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({ data: publicConfigState.data }),
}));

vi.mock("../../../editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../editor")>();
  return {
    ...actual,
    useEditorUpload: (
      uploadFile?: (
        file: File,
        ctx?: { taskId?: string },
      ) => Promise<unknown>,
    ) => ({
      upload: async (file: File, ctx?: { taskId?: string }) => {
        if (!uploadFile) return null;
        return uploadFile(file, ctx);
      },
      uploading: false,
    }),
    useAttachmentPreview: () => ({
      tryOpen: tryOpenPreview,
      open: vi.fn(),
      modal: null,
    }),
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

function shell(ui: React.ReactElement) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  uploadMutateAsync.mockClear();
  deleteMutateAsync.mockClear();
  tryOpenPreview.mockClear();
  attachmentsState.data = [];
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
  };
});

describe("TaskDetailAttachmentsSection", () => {
  it("shows empty state when there are no attachments", () => {
    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(
      screen.getByText(/chưa có tệp đính kèm|no attachments yet/i),
    ).toBeInTheDocument();
  });

  it("uploads a chosen file via the attachment mutation", async () => {
    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    const file = new File(["png"], "shot.png", { type: "image/png" });
    const input = screen.getByLabelText(/thêm tệp|add file|upload/i);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadMutateAsync).toHaveBeenCalledWith(file);
    });
  });

  it("lists attachments and only previews image/pdf allowlist kinds", () => {
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

    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText("notes.docx")).toBeInTheDocument();

    const previewButtons = screen.getAllByRole("button", {
      name: /xem trước|preview/i,
    });
    expect(previewButtons).toHaveLength(1);
    fireEvent.click(previewButtons[0]!);
    expect(tryOpenPreview).toHaveBeenCalled();
  });

  it("shows capability reason and disables upload when unavailable", () => {
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
    };

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(
      screen.getByText(/bề mặt này chưa sẵn sàng|this surface is not ready/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/thêm tệp|add file|upload/i)).toBeDisabled();
  });
});
