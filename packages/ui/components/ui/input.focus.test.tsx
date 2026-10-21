import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { InputGroup, InputGroupInput } from "./input-group";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Textarea } from "./textarea";

/**
 * Text fields draw their own focus ring (composites replace it through ring
 * utilities), so it must be the solid --ring, the colour of the global
 * outline: the 30% ring it replaced measured 1.63:1.
 */
describe("text field focus", () => {
  it.each([
    ["Input", () => <Input aria-label="Tên" />],
    ["Textarea", () => <Textarea aria-label="Ghi chú" />],
  ])("%s focuses with a solid ring, red when invalid", (_, field) => {
    render(field());
    const el = screen.getByRole("textbox");
    expect(el).toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring", "aria-invalid:focus-visible:ring-destructive");
    expect(el.className).not.toContain("ring-ring/30");
  });
});

describe("InputGroup focus", () => {
  it("lights the group with a solid ring, red when the control is invalid", () => {
    render(
      <InputGroup>
        <InputGroupInput aria-label="Tìm" />
      </InputGroup>,
    );
    const group = screen.getByRole("group");
    expect(group).toHaveClass(
      "has-[[data-slot=input-group-control]:focus-visible]:ring-ring",
      "has-[[data-slot=input-group-control]:focus-visible]:has-[[data-slot][aria-invalid=true]]:ring-destructive",
    );
    expect(group.className).not.toContain("ring-ring/30");
  });
});

describe("Checkbox", () => {
  it("leaves focus to the global outline and grows to 44px on a coarse pointer", () => {
    render(<Checkbox aria-label="Chọn" />);
    const box = screen.getByRole("checkbox", { name: "Chọn" });
    expect(box.className).not.toMatch(/outline-none|focus-visible:ring/);
    expect(box).toHaveClass("pointer-coarse:after:-inset-3.5");
  });
});

describe("RadioGroupItem", () => {
  it("leaves focus to the global outline and grows its hit area to 44px on a coarse pointer", () => {
    render(
      <RadioGroup>
        <RadioGroupItem value="a" aria-label="A" />
      </RadioGroup>,
    );
    const radio = screen.getByRole("radio", { name: "A" });
    // The 50% ring it drew read under 3:1, as the checkbox's did.
    expect(radio.className).not.toMatch(/outline-none|focus-visible:ring/);
    expect(radio).toHaveClass("pointer-coarse:after:-inset-3.5");
  });
});
