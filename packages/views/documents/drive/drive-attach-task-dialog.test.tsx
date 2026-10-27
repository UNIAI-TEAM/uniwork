import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import type { DriveFile } from "@uniwork/core/drive-library";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { DriveAttachTaskDialog } from "./drive-attach-task-dialog";

const { t } = initI18n();

function makeFile(over: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "df1",
    organization_id: "org1",
    workspace_id: "ws1",
    external_file_id: "ext-1",
    name: "Kế hoạch Q4",
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    web_view_link: "https://docs.google.com/document/d/ext-1/edit",
    open_url: "https://docs.google.com/document/d/ext-1/edit",
    owner_display: "Lan",
    sharing_state: "private",
    connection_id: "conn1",
    bound_account_email: "uni@gmail.com",
    bound_connection_lost: false,
    bound_by_id: "u1",
    bound_by_name: "Minh",
    created_by: "u1",
    created_by_kind: "human",
    created_by_name: "Minh",
    created_at: "2026-10-26T08:00:00Z",
    updated_at: "2026-10-26T08:00:00Z",
    viewer_access: "granted",
    viewer_connection_id: "conn1",
    viewer_account_email: "uni@gmail.com",
    can_unlink: true,
    can_rebind: false,
    can_propose: true,
    can_ask: true,
    used_in_count: 1,
    used_in_tasks: [
      { task_id: "t1", identifier: "UNI-1", title: "Việc đã gắn", status: "todo" },
    ],
    tasks_created: { count: 0 },
    task_creations: [],
    ...over,
  };
}

function mockTaskRows() {
  return {
    query_fingerprint: "fp1",
    group_key: null,
    parent_id: null,
    total: 2,
    rows: [
      {
        task: {
          id: "t1",
          workspace_id: "ws1",
          identifier: "UNI-1",
          title: "Việc đã gắn",
          description: "",
          created_by: "u1",
          status: "todo",
          priority: "medium",
          position: 1,
          revision: 1,
          created_at: "2026-10-26T08:00:00Z",
          updated_at: "2026-10-26T08:00:00Z",
        },
        direct_child_count: 0,
        labels: [],
      },
      {
        task: {
          id: "t2",
          workspace_id: "ws1",
          identifier: "UNI-2",
          title: "Việc mới cần gắn",
          description: "",
          created_by: "u1",
          status: "in_progress",
          priority: "medium",
          position: 2,
          revision: 1,
          created_at: "2026-10-26T08:05:00Z",
          updated_at: "2026-10-26T08:05:00Z",
        },
        direct_child_count: 0,
        labels: [],
      },
    ],
    next_cursor: null,
  };
}

describe("DriveAttachTaskDialog", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("marks used_in_tasks as disabled ('đã gắn'), requires §7.1 confirmation when sharing_state !== 'shared', and attaches on confirm", async () => {
    const toastSuccessSpy = vi.spyOn(toast, "success").mockImplementation(() => "");
    const onOpenChange = vi.fn();

    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/workspaces/ws1/tasks/table/rows" && opts?.method === "POST") {
        return Promise.resolve(mockTaskRows());
      }
      if (path === "/api/v1/workspaces/ws1/drive-files" && opts?.method === "POST") {
        return Promise.resolve({
          results: [
            {
              external_file_id: "ext-1",
              outcome: "linked",
              account_email: "uni@gmail.com",
              file: {
                id: "df1",
                workspace_id: "ws1",
                external_file_id: "ext-1",
                name: "Kế hoạch Q4",
                mime_type: "application/vnd.google-apps.document",
                icon_kind: "google_doc",
                sharing_state: "private",
                web_view_link: "https://docs.google.com/document/d/ext-1/edit",
                open_url: "https://docs.google.com/document/d/ext-1/edit",
                viewer_access: "granted",
              },
            },
          ],
        });
      }
      return Promise.resolve({});
    });

    render(
      wrap(
        <DriveAttachTaskDialog
          open
          onOpenChange={onOpenChange}
          wsId="ws1"
          file={makeFile({ sharing_state: "private" })}
        />,
      ),
    );

    const dialog = await screen.findByRole("dialog");
    const disabledOpt = await within(dialog).findByRole("option", {
      name: /Việc đã gắn, đã gắn/,
    });
    expect(disabledOpt).toHaveAttribute("aria-disabled", "true");

    const submitBtn = within(dialog).getByRole("button", {
      name: t("driveLibrary.detail.used_in.attach_dialog.submit"),
    });
    expect(submitBtn).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(within(dialog).getByRole("option", { name: "Việc mới cần gắn" }));
    expect(submitBtn).not.toHaveAttribute("aria-disabled");

    fireEvent.click(submitBtn);

    const confirmDialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(confirmDialog).getByRole("button", {
        name: t("drive.picker.confirm_dialog.confirm", { count: 1 }),
      }),
    );

    await waitFor(() =>
      expect(toastSuccessSpy).toHaveBeenCalledWith(
        t("drive.picker.outcomes.linked", { count: 1 }),
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    toastSuccessSpy.mockRestore();
  });

  it("attaches immediately without §7.1 confirmation when sharing_state === 'shared' and shows localized error toast on failure", async () => {
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");

    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/workspaces/ws1/tasks/table/rows" && opts?.method === "POST") {
        return Promise.resolve(mockTaskRows());
      }
      if (path === "/api/v1/workspaces/ws1/drive-files" && opts?.method === "POST") {
        return Promise.reject(new ApiError("forbidden", "forbidden", 403));
      }
      return Promise.resolve({});
    });

    render(
      wrap(
        <DriveAttachTaskDialog
          open
          onOpenChange={vi.fn()}
          wsId="ws1"
          file={makeFile({ sharing_state: "shared" })}
        />,
      ),
    );

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("option", { name: "Việc mới cần gắn" }));
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: t("driveLibrary.detail.used_in.attach_dialog.submit"),
      }),
    );

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() =>
      expect(toastErrorSpy).toHaveBeenCalledWith(t("errors.api.forbidden")),
    );
    toastErrorSpy.mockRestore();
  });
});
