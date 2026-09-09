import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TitleEditor } from "./title-editor";

describe("TitleEditor", () => {
  it("mounts a contenteditable surface", async () => {
    render(<TitleEditor defaultValue="Hello" />);
    expect(await screen.findByRole("textbox")).toHaveAttribute("contenteditable", "true");
  });
});
