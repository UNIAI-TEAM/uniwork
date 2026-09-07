import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";

/**
 * Form controls are 32px on a desktop, which is fine for a mouse and too small
 * for a thumb. The button primitive already grows to 44px on a coarse pointer;
 * this pins the same contract on the text-entry primitive.
 */
describe("touch targets on a coarse pointer", () => {
  it("Input grows to 44px", () => {
    const { container } = render(<Input />);
    expect(container.querySelector("input")?.className).toContain("pointer-coarse:min-h-11");
  });
});
