import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxCommentsPanel } from "./comments-panel";
import { commentsI18nResources } from "./comments-i18n";
import type { PptxComment } from "./comments-panel-state";

const i18n = initI18n();
i18n.addResourceBundle("en", "translation", commentsI18nResources("en"), true, true);
i18n.addResourceBundle("vi", "translation", commentsI18nResources("vi"), true, true);
beforeEach(async () => { await setLocale("en"); });

const comment = (over: Partial<PptxComment> = {}): PptxComment => ({
  authorId: 1,
  author: "An Nguyen",
  initials: "AN",
  dt: "2026-10-04T09:00:00.000Z",
  idx: 2,
  text: "Please review the chart",
  ...over,
});

describe("PptxCommentsPanel", () => {
  it("lists the slide's comments with author, avatar and time", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[comment()]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    const panel = screen.getByRole("region", { name: "Comments" });
    expect(panel).toHaveAttribute("data-pptx-comments-mode", "ready");
    expect(screen.getByTestId("pptx-comments-slide")).toHaveTextContent("Comments on slide 1");
    expect(screen.getByTestId("pptx-comments-count")).toHaveTextContent("1 comment");
    expect(screen.getByTestId("pptx-comments-count")).not.toHaveTextContent("1 comments");
    expect(screen.getByText("An Nguyen")).toBeInTheDocument();
    expect(screen.getByText("AN")).toBeInTheDocument();
    expect(screen.getByText("Please review the chart")).toBeInTheDocument();
    expect(panel.querySelector('[data-pptx-comment="1:2"]')).not.toBeNull();
  });

  it("pluralizes the count once a slide has several comments", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[comment(), comment({ authorId: 2, idx: 3 })]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByTestId("pptx-comments-count")).toHaveTextContent("2 comments");
  });

  it("shows the empty state when the slide has no comments", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByTestId("pptx-comments-empty")).toHaveTextContent("No comments on this slide.");
  });

  it("posts a comment with the author and text, then clears the draft", async () => {
    const onAddComment = vi.fn();
    render(<PptxCommentsPanel slideIndex={1} comments={[]} defaultAuthor="An Nguyen" onAddComment={onAddComment} onDeleteComment={vi.fn()} />);
    const textbox = screen.getByRole("textbox", { name: "Write a comment" });
    fireEvent.change(textbox, { target: { value: "  Check the numbers  " } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(onAddComment).toHaveBeenCalledWith(1, "Check the numbers", "An Nguyen");
    // The draft clears once the add resolves (a failure keeps it, see below).
    await waitFor(() => expect(textbox).toHaveValue(""));
  });

  it("keeps the typed comment when the add rejects", async () => {
    const onAddComment = vi.fn().mockRejectedValue(new Error("refused"));
    render(<PptxCommentsPanel slideIndex={0} comments={[]} defaultAuthor="An" onAddComment={onAddComment} onDeleteComment={vi.fn()} />);
    const textbox = screen.getByRole("textbox", { name: "Write a comment" });
    fireEvent.change(textbox, { target: { value: "keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(onAddComment).toHaveBeenCalledWith(0, "keep me", "An");
    await waitFor(() => expect(onAddComment).toHaveBeenCalled());
    expect(textbox).toHaveValue("keep me");
  });

  it("fills the author field when the session author resolves after mount", () => {
    const { rerender } = render(<PptxCommentsPanel slideIndex={0} comments={[]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Author" })).toHaveValue("");
    rerender(<PptxCommentsPanel slideIndex={0} comments={[]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} defaultAuthor="An Nguyen" />);
    expect(screen.getByRole("textbox", { name: "Author" })).toHaveValue("An Nguyen");
  });

  it("keeps Post disabled until both author and text are present", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    const post = screen.getByRole("button", { name: "Post comment" });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Write a comment" }), { target: { value: "hello" } });
    expect(post).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Author" }), { target: { value: "An" } });
    expect(post).toBeEnabled();
  });

  it("deletes a comment by its authorId+idx pair", () => {
    const onDeleteComment = vi.fn();
    render(<PptxCommentsPanel slideIndex={2} comments={[comment({ authorId: 4, idx: 7 })]} onAddComment={vi.fn()} onDeleteComment={onDeleteComment} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete comment by An Nguyen" }));
    expect(onDeleteComment).toHaveBeenCalledWith(2, 4, 7);
  });

  it("renders reply/resolve as disabled controls with the unsupported reason", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[comment()]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Reply" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Resolve" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("pptx-comments-unsupported")).toHaveTextContent("not supported");
  });

  it("stays honest when no comments port is bound", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[]} />);
    expect(screen.getByTestId("pptx-comments-panel")).toHaveAttribute("data-pptx-comments-mode", "unbound");
    expect(screen.getByTestId("pptx-comments-unbound")).toHaveTextContent("not connected");
    expect(screen.queryByRole("button", { name: "Post comment" })).not.toBeInTheDocument();
  });

  it("asks for a slide when none is selected", () => {
    render(<PptxCommentsPanel slideIndex={null} comments={[]} onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByTestId("pptx-comments-panel")).toHaveAttribute("data-pptx-comments-mode", "no_slide");
    expect(screen.getByTestId("pptx-comments-no-slide")).toHaveTextContent("Select a slide");
  });

  it("shows a loading status while the host fetches the comments", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[]} loading onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByTestId("pptx-comments-panel")).toHaveAttribute("data-pptx-comments-mode", "loading");
    expect(screen.getByTestId("pptx-comments-loading")).toHaveTextContent("Loading comments");
  });

  it("keeps the list read-only without a composer on a read-only document", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[comment()]} readonly onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    expect(screen.getByText("Please review the chart")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete comment by An Nguyen" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Post comment" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pptx-comments-readonly")).toHaveTextContent("read-only");
  });

  it("surfaces a host error as an alert", () => {
    render(<PptxCommentsPanel slideIndex={0} comments={[]} error="bad_comment_text" onAddComment={vi.fn()} onDeleteComment={vi.fn()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The comment could not be applied");
    expect(alert).toHaveTextContent("bad_comment_text");
  });

  it("posts on Ctrl+Enter and clears on Escape", async () => {
    const onAddComment = vi.fn();
    render(<PptxCommentsPanel slideIndex={0} comments={[]} defaultAuthor="An" onAddComment={onAddComment} onDeleteComment={vi.fn()} />);
    const textbox = screen.getByRole("textbox", { name: "Write a comment" });
    fireEvent.change(textbox, { target: { value: "hi" } });
    fireEvent.keyDown(textbox, { key: "Enter", ctrlKey: true });
    expect(onAddComment).toHaveBeenCalledWith(0, "hi", "An");
    await waitFor(() => expect(textbox).toHaveValue(""));
    fireEvent.change(textbox, { target: { value: "draft" } });
    fireEvent.keyDown(textbox, { key: "Escape" });
    expect(textbox).toHaveValue("");
  });
});
