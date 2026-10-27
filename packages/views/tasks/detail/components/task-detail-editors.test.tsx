import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser, useAuthStore } from "@uniwork/core/auth";
import {
  FeatureFlagService,
  FeatureFlagsProvider,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import type { Task, User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../../test/api-mock";
import { TaskDetailEditors } from "./task-detail-editors";

// The sections below the editors are not under test and each pulls its own queries.
const attachmentsSlotSpy = vi.hoisted(() => vi.fn());
vi.mock("./task-detail-attachments-slot", () => ({
  TaskDetailAttachmentsSlot: (props: Record<string, unknown>) => {
    attachmentsSlotSpy(props);
    return null;
  },
}));
vi.mock("./task-detail-context-line", () => ({ TaskDetailContextLine: () => null }));
vi.mock("./subtasks-section", () => ({ TaskDetailSubtasksSection: () => null }));
vi.mock("./task-detail-timeline-slot", () => ({ TaskDetailTimelineSlot: () => null }));
vi.mock("../../../graph/node-history-section", () => ({ NodeHistorySection: () => null }));

const task = {
  id: "t1",
  title: "Plan",
  description:
    "[spec](/acme/eng/documents/D1) and [pr](https://example.com/acme/eng/documents/D2) and [t](/acme/eng/tasks/UNI-0)",
} as Task;
const sessionUser: User = {
  id: "u1",
  email: "u1@example.com",
  display_name: "User One",
  onboarded_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: "w1",
  slug: "eng",
  name: "Eng",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const QUERY_WAIT_OPTIONS = { timeout: 5000 } as const;

async function mountAndFindLink(name: string) {
  const nav = fakeNav("/acme/eng/tasks/t1");
  const view = render(
    wrapWithNav(
      <TaskDetailEditors task={task} workspaceId="w1" onSaveTitle={vi.fn()} onSaveDescription={vi.fn()} />,
      nav,
    ),
  );
  const link = await waitFor(() => {
    const el = Array.from(view.container.querySelectorAll("a")).find((a) => a.textContent === name);
    expect(el).toBeTruthy();
    return el as HTMLAnchorElement;
  }, QUERY_WAIT_OPTIONS);
  return { nav, link };
}

describe("TaskDetailEditors link context (DOC7-W03)", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    requestMock.mockReset();
    attachmentsSlotSpy.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(async () => {
    // useSession() starts a refresh on mount; let it settle inside its own test, or a
    // refresh left over from an unauthenticated case lands on the next test's seeded user.
    await useAuthStore.getState().initialize();
    resetAuthStoreForTests();
  });

  it("tags an internal document link in the description with ?from=task:<task id>", async () => {
    const { nav, link } = await mountAndFindLink("spec");
    act(() => {
      fireEvent.click(link);
    });
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/documents/D1?from=task:t1");
  });

  it("does not tag a non-document internal link", async () => {
    const { nav, link } = await mountAndFindLink("t");
    act(() => {
      fireEvent.click(link);
    });
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/tasks/UNI-0");
  });

  it("does not tag an external link", async () => {
    const { nav, link } = await mountAndFindLink("pr");
    act(() => {
      fireEvent.click(link);
    });
    expect(nav.push).not.toHaveBeenCalled();
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com/acme/eng/documents/D2",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("names the description editor for assistive tech", async () => {
    const { link } = await mountAndFindLink("spec");
    expect(link.closest("[role=textbox]")).toHaveAttribute("aria-label", "Mô tả công việc");
  });

  it("passes canEdit: true to TaskDetailAttachmentsSlot when the signed-in user is a workspace member", async () => {
    setSessionUser(sessionUser);
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces/w1/me") {
        return {
          membership: { user_id: "u1", role: "member", source: "membership" },
        };
      }
      return [];
    });
    await mountAndFindLink("spec");
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/w1/me");
      expect(attachmentsSlotSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "w1",
          taskId: "t1",
          canEdit: true,
        }),
      );
    }, QUERY_WAIT_OPTIONS);
  });

  it("passes canEdit: false to TaskDetailAttachmentsSlot when the signed-in user has no workspace membership", async () => {
    setSessionUser(sessionUser);
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/workspaces/w1/me") {
        throw Object.assign(new Error("forbidden"), { status: 403 });
      }
      return [];
    });
    await mountAndFindLink("spec");
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/w1/me");
      expect(attachmentsSlotSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "w1",
          taskId: "t1",
          canEdit: false,
        }),
      );
    }, QUERY_WAIT_OPTIONS);
  });

  it("shows no Drive paste chip when the user has no workspace role, and shows a chip when the user is a member (F-2)", async () => {
    setSessionUser(sessionUser);
    let currentRole: "member" | null = null;
    requestMock.mockImplementation(async (path: string) => {
      if (path === "/api/v1/config") {
        return {
          flags: { drive_connector: true },
          rum_sample_rate: 0,
          drive: { available: true },
        };
      }
      if (path === "/api/v1/workspaces/w1/me") {
        if (!currentRole) {
          throw Object.assign(new Error("forbidden"), { status: 403 });
        }
        return {
          membership: {
            user_id: "u1",
            role: currentRole,
            source: "membership",
          },
        };
      }
      if (path === "/api/v1/workspaces/w1/drive-connections") {
        return { connections: [] };
      }
      if (path === "/api/v1/tasks/t1/drive-files") {
        return { files: [] };
      }
      return [];
    });

    const service = new FeatureFlagService(
      new StaticProvider({ drive_connector: { default: true } }),
    );
    const pasteUrl = (editorEl: HTMLElement, url: string) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [],
          getData: (type: string) => (type === "text/plain" ? url : ""),
        },
      });
      act(() => {
        editorEl.dispatchEvent(event);
      });
    };

    // 1. User with no workspace role (403 on /me -> cannot edit) pastes a Drive URL -> no chip
    const viewerView = render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={sessionUser}>
            <TaskDetailEditors
              task={task}
              workspaceId="w1"
              onSaveTitle={vi.fn()}
              onSaveDescription={vi.fn()}
            />
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
        fakeNav("/acme/eng/tasks/t1"),
      ),
    );
    const viewerEditor = await waitFor(() => {
      const el = viewerView.container.querySelector("[role=textbox]");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    }, QUERY_WAIT_OPTIONS);
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/w1/me");
      expect(attachmentsSlotSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ canEdit: false }),
      );
    }, QUERY_WAIT_OPTIONS);
    pasteUrl(
      viewerEditor,
      "https://docs.google.com/document/d/1GdocViewerBlocked_012345/edit",
    );
    expect(
      viewerView.container.querySelector(
        '[data-testid="drive-paste-suggestion-chips"]',
      ),
    ).toBeNull();
    viewerView.unmount();

    // 2. Editor (member) pastes a Drive URL -> chip appears
    currentRole = "member";
    const editorView = render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={sessionUser}>
            <TaskDetailEditors
              task={task}
              workspaceId="w1"
              onSaveTitle={vi.fn()}
              onSaveDescription={vi.fn()}
            />
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
        fakeNav("/acme/eng/tasks/t1"),
      ),
    );
    const memberEditor = await waitFor(() => {
      const el = editorView.container.querySelector("[role=textbox]");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    }, QUERY_WAIT_OPTIONS);
    await waitFor(() => {
      expect(
        requestMock.mock.calls.filter(([path]) => path === "/api/v1/workspaces/w1/me").length,
      ).toBeGreaterThanOrEqual(2);
      expect(attachmentsSlotSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ canEdit: true }),
      );
    }, QUERY_WAIT_OPTIONS);
    pasteUrl(
      memberEditor,
      "https://docs.google.com/document/d/1GdocEditorAllowed_012345/edit",
    );
    await waitFor(() => {
      expect(
        editorView.container.querySelector(
          '[data-testid="drive-paste-suggestion-chip-1GdocEditorAllowed_012345"]',
        ),
      ).not.toBeNull();
    }, QUERY_WAIT_OPTIONS);
  });
});
