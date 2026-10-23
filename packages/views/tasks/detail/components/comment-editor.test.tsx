import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNav, requestMock, wrapWithNav } from "../../../test/api-mock";
import { TaskCommentEditor } from "./comment-editor";

describe("TaskCommentEditor link context (DOC7-W03)", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("tags an internal document link in a task comment with ?from=task:<task id>", async () => {
    const nav = fakeNav("/acme/eng/tasks/t1");
    const view = render(
      wrapWithNav(
        <TaskCommentEditor
          taskId="t1"
          body="[spec](/acme/eng/documents/D1)"
          onSave={vi.fn().mockResolvedValue(true)}
          onCancel={vi.fn()}
        />,
        nav,
      ),
    );
    const link = await waitFor(() => {
      const el = view.container.querySelector("a");
      expect(el).toBeTruthy();
      return el as HTMLAnchorElement;
    });
    act(() => {
      fireEvent.click(link);
    });
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/documents/D1?from=task:t1");
  });
});
