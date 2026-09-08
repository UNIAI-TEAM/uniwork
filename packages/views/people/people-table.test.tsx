import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { PeopleColumnKey } from "@uniwork/core/people/view-store";
import type { Person } from "@uniwork/core/types/people";
import { wrapWithNav } from "../test/api-mock";
import { PeopleTable } from "./people-table";

initI18n();

function person(n: number): Person {
  return {
    user_id: `u${n}`,
    display_name: `Người ${n}`,
    email: `n${n}@acme.vn`,
    org_role: "member",
    status: "active",
    title: "Kỹ sư",
    department: { id: "d1", name: "Kỹ thuật" },
    phone: "0900000000",
    phone_visible: true,
    timezone: "Asia/Ho_Chi_Minh",
    is_self: false,
  };
}

const many = Array.from({ length: 500 }, (_, i) => person(i));

function renderTable({
  people = [person(1)],
  hiddenColumns = [] as PeopleColumnKey[],
  hasNextPage = false,
  onLoadMore = vi.fn(),
}) {
  render(
    wrapWithNav(
      <PeopleTable
        people={people}
        hrefFor={(id) => `/acme/doi/people/${id}`}
        hiddenColumns={hiddenColumns}
        hasNextPage={hasNextPage}
        isFetchingNextPage={false}
        onLoadMore={onLoadMore}
      />,
    ),
  );
}

/** Give the scroll container a height, the way a browser with layout would. */
function withViewport(height: number) {
  const clientHeight = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(height);
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1200, height, top: 0, left: 0, right: 1200, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  });
  return () => {
    clientHeight.mockRestore();
    rect.mockRestore();
  };
}

describe("PeopleTable", () => {
  it("gives every column a header and every person a row", () => {
    renderTable({});
    expect(screen.getByText("Tên")).toBeInTheDocument();
    expect(screen.getByText("Chức danh")).toBeInTheDocument();
    expect(screen.getByText("Phòng ban")).toBeInTheDocument();
    expect(screen.getByText("Điện thoại")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Người 1" })).toHaveAttribute(
      "href",
      "/acme/doi/people/u1",
    );
  });

  it("drops the header and the cell of a hidden column", () => {
    renderTable({ hiddenColumns: ["phone", "email"] });
    expect(screen.queryByText("Điện thoại")).toBeNull();
    expect(screen.queryByText("0900000000")).toBeNull();
    expect(screen.queryByText("n1@acme.vn")).toBeNull();
    // The columns left alone are still there.
    expect(screen.getByText("Phòng ban")).toBeInTheDocument();
  });

  it("renders every row when the viewport has not been measured", () => {
    renderTable({ people: [person(1), person(2)] });
    expect(screen.getByRole("link", { name: "Người 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Người 2" })).toBeInTheDocument();
  });

  it("renders only the visible window once the viewport is measured", () => {
    const restore = withViewport(600);
    try {
      renderTable({ people: many });
      const rows = screen.getAllByRole("row");
      // 600px of viewport at 48px a row is about thirteen, plus overscan and
      // the header — far fewer than the five hundred people in the list.
      expect(rows.length).toBeLessThan(60);
      expect(rows.length).toBeGreaterThan(1);
      expect(screen.getByRole("link", { name: "Người 0" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Người 400" })).toBeNull();
    } finally {
      restore();
    }
  });

  it("states the whole directory's row count, not the size of the window", () => {
    const restore = withViewport(600);
    try {
      renderTable({ people: many });
      // The header is row one, so the count includes it.
      expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "501");
      const rows = screen.getAllByRole("row");
      expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
      expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
    } finally {
      restore();
    }
  });

  it("badges a deactivated person beside their name, not only in the status column", () => {
    const gone: Person = { ...person(3), status: "deactivated" };
    renderTable({ people: [gone], hiddenColumns: ["status"] });
    expect(screen.getByText("Đã vô hiệu hóa")).toBeInTheDocument();
  });

  it("shows row-shaped placeholders while the next page loads", () => {
    render(
      wrapWithNav(
        <PeopleTable
          people={[person(1)]}
          hrefFor={(id) => `/acme/doi/people/${id}`}
          hiddenColumns={[]}
          hasNextPage
          isFetchingNextPage
          onLoadMore={vi.fn()}
        />,
      ),
    );
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("asks for the next page once the last row is rendered", () => {
    const onLoadMore = vi.fn();
    renderTable({ people: [person(1)], hasNextPage: true, onLoadMore });
    expect(onLoadMore).toHaveBeenCalled();
  });
});
