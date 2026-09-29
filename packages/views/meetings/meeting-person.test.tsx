import { fireEvent, render, screen } from "@testing-library/react";
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

describe("MeetingPersonAvatar at stage size", () => {
  it("keeps the initials until the photo loads, then fades the photo in over them", () => {
    const { container } = render(<MeetingPersonAvatar size="stage" name="Nguyễn Văn An" avatarUrl="https://cdn/an.png" />);
    const img = container.querySelector("img")!;
    expect(img).toHaveClass("opacity-0");
    expect(screen.getByText("NA")).not.toHaveClass("invisible");
    fireEvent.load(img);
    expect(img).toHaveClass("opacity-100");
    expect(screen.getByText("NA")).toHaveClass("invisible");
  });

  it("falls back to initials when the photo fails, and shows an emoji avatar as is", () => {
    const { container, rerender } = render(<MeetingPersonAvatar size="stage" name="An" avatarUrl="https://cdn/broken.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("A")).toBeVisible();
    rerender(<MeetingPersonAvatar size="stage" name="An" avatarUrl="emoji:🦊" />);
    expect(screen.getByText("🦊")).toBeInTheDocument();
  });
});
