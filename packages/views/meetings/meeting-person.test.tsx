import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initials, MeetingPersonAvatar } from "./meeting-person";

describe("initials", () => {
  it("derives initials from display names", () => {
    expect(initials("")).toBe("?");
    expect(initials("  ")).toBe("?");
    expect(initials("alice")).toBe("A");
    expect(initials("Nguyễn Văn An")).toBe("NA");
  });
});

describe("MeetingPersonAvatar", () => {
  it("renders initials in the avatar fallback", () => {
    render(<MeetingPersonAvatar name="Nguyễn Văn An" />);
    expect(screen.getByText("NA")).toBeInTheDocument();
  });

  it("renders the photo when an avatar URL is known", () => {
    const { container } = render(
      <MeetingPersonAvatar name="Nguyễn Văn An" avatarUrl="https://cdn.test/an.png" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn.test/an.png");
    expect(screen.queryByText("NA")).toBeNull();
  });

  it("falls back to initials when the avatar URL is empty or not a string", () => {
    const { container, rerender } = render(<MeetingPersonAvatar name="alice" avatarUrl="" />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    rerender(<MeetingPersonAvatar name="alice" avatarUrl={{ url: "x" }} />);
    expect(container.querySelector("img")).toBeNull();
  });

  it("sizes via the size prop (semantic tier), not className overrides", () => {
    const { container } = render(<MeetingPersonAvatar name="Nguyễn Văn An" size="xl" />);
    const inner = container.querySelector("[data-slot='avatar'] [data-slot='avatar']") as HTMLElement;
    expect(inner.style.width).toBe("56px");
  });
});
