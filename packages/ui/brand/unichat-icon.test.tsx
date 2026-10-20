import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { MARK, MARK_COMPACT } from "./mark.generated";
import { UniChatIcon } from "./unichat-icon";

afterEach(cleanup);

const ribbonOf = (container: HTMLElement) =>
  [...container.querySelectorAll("path")].map((p) => p.getAttribute("d")).find((d) => d === MARK.ribbon || d === MARK_COMPACT.ribbon);

describe("UniChatIcon", () => {
  it("announces UniChat, or nothing when decorative", () => {
    const { container, rerender } = render(<UniChatIcon />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("UniChat");
    rerender(<UniChatIcon decorative />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBeNull();
  });

  it("gives every instance its own gradient ids", () => {
    const { container } = render(
      <>
        <UniChatIcon />
        <UniChatIcon />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("draws the compact mark once the mark inside is small enough to lose its head gap", () => {
    const { container, rerender } = render(<UniChatIcon size={160} />);
    expect(ribbonOf(container)).toBe(MARK.ribbon);
    rerender(<UniChatIcon size={64} />);
    expect(ribbonOf(container)).toBe(MARK_COMPACT.ribbon);
  });
});
