import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TextField } from "./connect-form-parts";

initI18n();

/**
 * The input inside grows to 44px on a coarse pointer (input.touch.test.tsx); the group drawing its border must
 * grow with it, or the input spills out. Only these groups: the shared InputGroup keeps its registry height.
 */
describe("Email Hub input groups on a coarse pointer", () => {
  it.each([
    ["the password with its show/hide toggle", { type: "password" }],
    ["the locked address of a mailbox being reconnected", { type: "email", readOnly: true, value: "an@gmail.com" }],
  ])("grow %s to 44px", (_, props) => {
    const { container } = render(<TextField id="f" label="Field" {...props} />);
    expect(container.querySelector("[data-slot=input-group]")?.className).toContain("pointer-coarse:min-h-11");
  });
});
