import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group";

/**
 * The group draws the box its input sits in: at 32px it would leave the
 * 44px coarse-pointer input (input.touch.test.tsx) spilling out of its border.
 */
describe("touch targets on a coarse pointer", () => {
  it("InputGroup grows to 44px with its input and its button", () => {
    render(
      <InputGroup data-testid="group">
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Hiện mật khẩu" />
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByTestId("group").className).toContain("pointer-coarse:min-h-11");
    expect(screen.getByRole("textbox").className).toContain("pointer-coarse:min-h-11");
    const button = screen.getByRole("button", { name: "Hiện mật khẩu" }).className;
    expect(button).toContain("pointer-coarse:min-h-11");
    expect(button).toContain("pointer-coarse:min-w-11");
  });
});
