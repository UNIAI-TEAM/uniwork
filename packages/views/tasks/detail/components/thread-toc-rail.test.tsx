import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskComment } from "@uniwork/core/types";
import { ThreadTocRail } from "./thread-toc-rail";
import type { ThreadNavThread } from "./thread-nav-helpers";

initI18n();

function thread(id: string, body: string): ThreadNavThread {
  const entry: TaskComment = {
    id,
    task_id: "task-1",
    author_id: "user-1",
    author_kind: "human",
    body,
    type: "comment",
    revision: 0,
    created_at: "2026-10-05T00:00:00Z",
    reactions: [],
  };
  return { id, entry, resolved: false, replyCount: 0, involvesMe: false };
}

const THREADS = [
  thread("comment-1", "First decision"),
  thread("comment-2", "Second decision"),
  thread("comment-3", "Third decision"),
];

describe("ThreadTocRail", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("renders one accessible jump target per comment thread", () => {
    const container = document.createElement("div");
    render(
      <ThreadTocRail
        threads={THREADS}
        scrollContainerEl={container}
        onJump={vi.fn()}
      />,
    );

    expect(screen.getByRole("navigation", { name: /comment threads|chuỗi bình luận/i }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "First decision" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("jumps to the selected thread and marks it active immediately", () => {
    const onJump = vi.fn();
    const container = document.createElement("div");
    render(
      <ThreadTocRail
        threads={THREADS}
        scrollContainerEl={container}
        onJump={onJump}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Third decision" }));

    expect(onJump).toHaveBeenCalledWith("comment-3");
    expect(screen.getByRole("button", { name: "Third decision" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("shows a comment preview when hovering a thread marker", async () => {
    const previewThread = thread("comment-1", "Decision\nNeeds API review");
    previewThread.entry.display_name = "Nguyen Van An";
    previewThread.replyCount = 2;
    previewThread.resolved = true;
    const onHoverThread = vi.fn();

    render(
      <ThreadTocRail
        threads={[previewThread]}
        scrollContainerEl={null}
        onJump={vi.fn()}
        onHoverThread={onHoverThread}
      />,
    );

    const marker = screen.getByRole("button", { name: /Decision/ });
    fireEvent.pointerEnter(marker);

    const preview = await screen.findByTestId("thread-toc-preview-comment-1");
    expect(preview).toHaveTextContent("Nguyen Van An");
    expect(preview).toHaveTextContent("Needs API review");
    expect(preview).toHaveTextContent("2");
    expect(onHoverThread).toHaveBeenCalledWith("comment-1");

    fireEvent.pointerLeave(marker);
    expect(screen.queryByTestId("thread-toc-preview-comment-1")).not.toBeInTheDocument();
    expect(onHoverThread).toHaveBeenLastCalledWith(null);
  });

  it("tracks the last thread that crossed the top reading line", () => {
    const container = document.createElement("div");
    const anchors = THREADS.map((item) => {
      const anchor = document.createElement("div");
      anchor.dataset.threadRootId = item.id;
      container.append(anchor);
      return anchor;
    });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 100,
    } as DOMRect);
    anchors.forEach((anchor, index) => {
      vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
        top: [40, 140, 360][index],
      } as DOMRect);
    });

    render(
      <ThreadTocRail
        threads={THREADS}
        scrollContainerEl={container}
        onJump={vi.fn()}
      />,
    );

    fireEvent.scroll(container);

    expect(screen.getByRole("button", { name: "Second decision" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    anchors.forEach((anchor) => anchor.remove());
  });
});
