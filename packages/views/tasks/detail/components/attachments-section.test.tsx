import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser, resetAuthStoreForTests } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { wrapWithNav } from "../../../test/api-mock";
import { TaskDetailAttachmentsSection } from "./attachments-section";

const deleteMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
  deleteMutateAsync.mockClear();
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
  it("stays out of the layout when there are no standalone attachments", () => {
    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(
      screen.queryByRole("region", { name: /đính kèm|attachments/i }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("region", { name: /đính kèm|attachments/i }),
    ).toBeNull();
  });

  it("keeps existing files visible but hides destructive actions when unavailable", () => {
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
    };

    render(
      shell(<TaskDetailAttachmentsSection workspaceId="w1" taskId="t1" />),
    );

    expect(screen.getByText("notes.docx")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /gỡ|xóa|remove|delete/i }),
    ).toBeNull();
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
});
