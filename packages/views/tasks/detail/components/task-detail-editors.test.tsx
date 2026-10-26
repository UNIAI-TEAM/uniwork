import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type { Task, User } from "@uniwork/core/types";
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
  });
  return { nav, link };
}

describe("TaskDetailEditors link context (DOC7-W03)", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    requestMock.mockReset();
    attachmentsSlotSpy.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
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
        return { role: "member", source: "membership" };
      }
      return [];
    });
    await mountAndFindLink("spec");
    await waitFor(() => {
      expect(attachmentsSlotSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "w1",
          taskId: "t1",
          canEdit: true,
        }),
      );
    });
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
      expect(attachmentsSlotSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          workspaceId: "w1",
          taskId: "t1",
          canEdit: false,
        }),
      );
    });
  });
});
