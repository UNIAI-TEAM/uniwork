import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Person } from "@uniwork/core/types/people";
import { wrapWithNav } from "../test/api-mock";
import { columnsForWidth, PeopleCards } from "./people-cards";

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
    phone_visible: false,
    timezone: "Asia/Ho_Chi_Minh",
    is_self: false,
  };
}

const many = Array.from({ length: 500 }, (_, i) => person(i));

function renderCards({
  people = [person(1)],
  total = undefined as number | undefined,
  hasNextPage = false,
  onLoadMore = vi.fn(),
}) {
  render(
    wrapWithNav(
      <PeopleCards
        people={people}
        total={total ?? people.length}
        hrefFor={(id) => `/acme/doi/people/${id}`}
        hasNextPage={hasNextPage}
        isFetchingNextPage={false}
        onLoadMore={onLoadMore}
        onChat={vi.fn()}
      />,
    ),
  );
}

/** Give the scroll container a box, the way a browser with layout would. */
function withViewport(width: number, height: number) {
  const clientHeight = vi
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(height);
  const clientWidth = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(width);
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  });
  return () => {
    clientHeight.mockRestore();
    clientWidth.mockRestore();
    rect.mockRestore();
  };
}

describe("columnsForWidth", () => {
  it("keeps one column until a second card fits", () => {
    expect(columnsForWidth(0)).toBe(1);
    expect(columnsForWidth(400)).toBe(1);
    expect(columnsForWidth(480)).toBe(2);
  });

  it("stops at four columns however wide the pane is", () => {
    expect(columnsForWidth(1200)).toBe(4);
    expect(columnsForWidth(4000)).toBe(4);
  });
});

describe("PeopleCards", () => {
  it("puts the name, job title and department on the card, and the email behind its button", () => {
    renderCards({});
    expect(screen.getByText("Người 1")).toBeInTheDocument();
    expect(screen.getByText("Kỹ sư")).toBeInTheDocument();
    expect(screen.getByText("Kỹ thuật")).toBeInTheDocument();
    // At card width the address was cut to a dozen characters; it now lives
    // on the mail button, as its target and its tooltip.
    const mail = screen.getByRole("link", { name: "Gửi email cho Người 1" });
    expect(mail).toHaveAttribute("href", "mailto:n1@acme.vn");
    expect(mail).toHaveAttribute("title", "n1@acme.vn");
  });

  it("offers chat to a colleague but not to the reader or a deactivated person", () => {
    render(
      wrapWithNav(
        <PeopleCards
          people={[person(1), { ...person(2), is_self: true }, { ...person(3), status: "deactivated" }]}
          total={3}
          hrefFor={(id) => `/acme/doi/people/${id}`}
          hasNextPage={false}
          isFetchingNextPage={false}
          onLoadMore={vi.fn()}
          onChat={vi.fn()}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: "Nhắn tin cho Người 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nhắn tin cho Người 2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nhắn tin cho Người 3" })).toBeNull();
    expect(screen.getByText("Bạn")).toBeInTheDocument();
    expect(screen.getByText("Đã vô hiệu hóa")).toBeInTheDocument();
  });

  it("names the card's link after the person, not after everything on the card", () => {
    renderCards({});
    // The anchor covers the card through a stretched pseudo-element, so the
    // whole card stays clickable while the accessible name stays short.
    expect(screen.getByRole("link", { name: "Người 1" })).toHaveAttribute(
      "href",
      "/acme/doi/people/u1",
    );
  });

  it("carries list semantics, with each card's place in the whole directory", () => {
    renderCards({ people: many });
    const list = screen.getByRole("list");
    expect(list).toHaveAttribute("aria-label", "Danh bạ");
    const first = screen.getAllByRole("listitem")[0]!;
    expect(first).toHaveAttribute("aria-posinset", "1");
    expect(first).toHaveAttribute("aria-setsize", "500");
  });

  it("states the directory's size as the server counts it, not the page loaded", () => {
    renderCards({ people: [person(1), person(2)], total: 240, hasNextPage: true });
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("aria-setsize", "240");
  });

  it("shows card-shaped placeholders while the next page loads", () => {
    render(
      wrapWithNav(
        <PeopleCards
          people={[person(1)]}
          total={1}
          hrefFor={(id) => `/acme/doi/people/${id}`}
          hasNextPage
          isFetchingNextPage
          onLoadMore={vi.fn()}
          onChat={vi.fn()}
        />,
      ),
    );
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it("renders every card when the viewport has not been measured", () => {
    renderCards({ people: [person(1), person(2)] });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders only the visible window once the viewport is measured", () => {
    const restore = withViewport(1200, 600);
    try {
      renderCards({ people: many });
      const cards = screen.getAllByRole("listitem");
      // Four columns of 112px rows in 600px of viewport is about six rows,
      // plus overscan — far fewer than the five hundred people in the list.
      expect(cards.length).toBeLessThan(120);
      expect(cards.length).toBeGreaterThan(0);
      expect(screen.getByText("Người 0")).toBeInTheDocument();
      expect(screen.queryByText("Người 400")).toBeNull();
    } finally {
      restore();
    }
  });

  it("asks for the next page once the last card is rendered", () => {
    const onLoadMore = vi.fn();
    renderCards({ people: [person(1)], hasNextPage: true, onLoadMore });
    expect(onLoadMore).toHaveBeenCalled();
  });
});
