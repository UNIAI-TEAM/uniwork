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
});
