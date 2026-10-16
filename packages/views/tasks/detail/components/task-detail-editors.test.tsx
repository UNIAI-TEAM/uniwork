import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@uniwork/core/types";
import { fakeNav, requestMock, wrapWithNav } from "../../../test/api-mock";
import { TaskDetailEditors } from "./task-detail-editors";

// The sections below the editors are not under test and each pulls its own queries.
vi.mock("./task-detail-attachments-slot", () => ({ TaskDetailAttachmentsSlot: () => null }));
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
    requestMock.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
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
});
