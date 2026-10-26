import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { countFeed, type MeetingFeedEntry } from "@uniwork/core/meetings/feed";
import { wrap } from "../../test/api-mock";
import { FeedFilterChips } from "./feed-filter-chips";

beforeAll(() => {
  initI18n();
});

const entry = (id: string, kind: MeetingFeedEntry["kind"]): MeetingFeedEntry => ({ id, kind, text: id, at: null, segmentId: null });

const counts = countFeed([entry("d1", "decision"), entry("d2", "decision"), entry("t1", "task"), entry("q1", "question")]);

describe("FeedFilterChips", () => {
  it("shows All and one chip per kind that has entries, with its count", () => {
    render(wrap(<FeedFilterChips counts={counts} value="all" onChange={() => {}} />));
    const group = screen.getByRole("group", { name: "Lọc theo loại" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tất cả, 4" })).toHaveTextContent("Tất cả4");
    expect(screen.getByRole("button", { name: "Quyết định, 2" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Việc cần làm, 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Câu hỏi còn mở, 1" })).toBeInTheDocument();
    // A kind with nothing in it has no chip.
    expect(screen.queryByRole("button", { name: /^Ghi chú/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Bản ghi/ })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  it("marks the chosen chip and hands the kind of the one pressed", () => {
    const onChange = vi.fn();
    render(wrap(<FeedFilterChips counts={counts} value="all" onChange={onChange} />));
    expect(screen.getByRole("button", { name: /^Tất cả/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Quyết định, 2" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Quyết định, 2" }));
    expect(onChange).toHaveBeenCalledWith("decision");
  });

  it("keeps All when the feed is empty", () => {
    render(wrap(<FeedFilterChips counts={countFeed([])} value="all" onChange={() => {}} />));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /^Tất cả/ })).toHaveTextContent("0");
  });
});
