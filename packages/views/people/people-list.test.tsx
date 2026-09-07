import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Person } from "@uniwork/core/types/people";
import { initI18n } from "@uniwork/core/i18n";
import { PeopleList } from "./people-list";

initI18n();

function person(n: number): Person {
  return {
    user_id: `u${n}`,
    display_name: `Người ${n}`,
    email: `n${n}@acme.vn`,
    org_role: "member",
    status: "active",
    title: "",
    phone_visible: false,
    timezone: "Asia/Ho_Chi_Minh",
    is_self: false,
  };
}

const many = Array.from({ length: 500 }, (_, i) => person(i));

function renderList(people: Person[], onLoadMore = vi.fn(), hasNextPage = false) {
  render(
    <PeopleList
      people={people}
      onOpen={() => {}}
      hasNextPage={hasNextPage}
      isFetchingNextPage={false}
      onLoadMore={onLoadMore}
    />,
  );
}

/** Give the scroll container a height, the way a browser with layout would. */
function withViewport(height: number) {
  const spy = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(height);
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ width: 900, height, top: 0, left: 0, right: 900, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
  return () => {
    spy.mockRestore();
    rect.mockRestore();
  };
}

describe("PeopleList", () => {
  it("renders every row when the viewport has not been measured", () => {
    renderList([person(1), person(2)]);
    expect(screen.getByText("Người 1")).toBeInTheDocument();
    expect(screen.getByText("Người 2")).toBeInTheDocument();
  });

  it("renders only the visible window once the viewport is measured", () => {
    const restore = withViewport(600);
    try {
      renderList(many);
      const rendered = screen.getAllByRole("listitem");
      // 600px of viewport at 57px a row is about eleven, plus overscan — far
      // fewer than the five hundred people in the list.
      expect(rendered.length).toBeLessThan(60);
      expect(rendered.length).toBeGreaterThan(0);
      expect(screen.getByText("Người 0")).toBeInTheDocument();
      expect(screen.queryByText("Người 400")).toBeNull();
    } finally {
      restore();
    }
  });

  it("asks for the next page once the last row is rendered", () => {
    const onLoadMore = vi.fn();
    renderList([person(1)], onLoadMore, true);
    expect(onLoadMore).toHaveBeenCalled();
  });
});
