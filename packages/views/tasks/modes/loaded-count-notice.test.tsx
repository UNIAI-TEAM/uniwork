import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskSurfacePagination } from "../surface/use-task-surface-data";
import { LoadedCountNotice } from "./loaded-count-notice";

const i18n = initI18n();

const pagination = (
  over: Partial<TaskSurfacePagination> = {},
): TaskSurfacePagination => ({
  loaded: 50,
  total: 120,
  hasMore: true,
  isLoadingMore: false,
  isLoadMoreError: false,
  loadMore: vi.fn(),
  ...over,
});

describe("modes/LoadedCountNotice", () => {
  it("says how many matching tasks are on screen, in a polite live region", () => {
    render(<LoadedCountNotice pagination={pagination()} />);

    const text = screen.getByText("Đang hiện 50 / 120 công việc");
    expect(text.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers load more for modes that have no list end to scroll to", () => {
    const loadMore = vi.fn();
    render(<LoadedCountNotice pagination={pagination({ loadMore })} withAction />);

    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("keeps that button inert while the page loads and offers retry after it fails", () => {
    const loadMore = vi.fn();
    const { rerender } = render(
      <LoadedCountNotice
        pagination={pagination({ loadMore, isLoadingMore: true })}
        withAction
      />,
    );
    const button = screen.getByRole("button", { name: "Tải thêm" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(loadMore).not.toHaveBeenCalled();

    rerender(
      <LoadedCountNotice
        pagination={pagination({ loadMore, isLoadMoreError: true })}
        withAction
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));

    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("disappears once every matching task is loaded", () => {
    const { container } = render(
      <LoadedCountNotice
        pagination={pagination({ loaded: 120, hasMore: false })}
        withAction
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("stays up, without an action, when paging stopped short of the total", () => {
    render(
      <LoadedCountNotice pagination={pagination({ hasMore: false })} withAction />,
    );

    expect(screen.getByText("Đang hiện 50 / 120 công việc")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads the count through _one / _other keys in both locales", () => {
    type Dict = { tasks?: { pagination?: Record<string, unknown> } };
    const viDict = i18n.getResourceBundle("vi", "translation") as Dict;
    for (const dict of [viDict, en as Dict]) {
      expect(dict.tasks?.pagination?.loaded_count_one).toEqual(expect.any(String));
      expect(dict.tasks?.pagination?.loaded_count_other).toEqual(expect.any(String));
    }

    i18n.addResourceBundle("en", "translation", en, true, true);
    const tEn = i18n.getFixedT("en");
    expect(tEn("tasks.pagination.loaded_count", { count: 1, total: 2 })).toBe(
      "Showing 1 task of 2",
    );
    expect(tEn("tasks.pagination.loaded_count", { count: 50, total: 120 })).toBe(
      "Showing 50 tasks of 120",
    );
  });
});
