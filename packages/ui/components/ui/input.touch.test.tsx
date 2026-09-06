import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./input";
import { NativeSelect } from "./native-select";

/**
 * Form controls are 32px on a desktop, which is fine for a mouse and too small
 * for a thumb. The button primitive already grows to 44px on a coarse pointer;
 * this pins the same contract on the two text-entry primitives.
 */
describe("touch targets on a coarse pointer", () => {
  it("Input grows to 44px", () => {
    const { container } = render(<Input />);
    expect(container.querySelector("input")?.className).toContain("pointer-coarse:min-h-11");
  });

  it("NativeSelect grows to 44px", () => {
    const { container } = render(<NativeSelect />);
    expect(container.querySelector("select")?.className).toContain("pointer-coarse:min-h-11");
  });
});
