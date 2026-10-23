import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PersonCombobox } from "./person-combobox";

const options = [{ id: "u1", name: "Bình", email: "binh@example.com" }];
const pinned = { id: "later", name: "Để sau", email: "" };

describe("PersonCombobox touch targets (RFE2-01)", () => {
  it("carries 44px coarse-pointer classes on the input and on an option", async () => {
    render(
      <PersonCombobox
        id="p"
        options={options}
        pinned={pinned}
        value={null}
        onValueChange={() => {}}
        placeholder="Pick"
        emptyLabel="None"
      />,
    );
    const input = screen.getByRole("combobox");
    expect(input.closest("[data-slot='input-group']")?.className).toContain("pointer-coarse:h-11");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const option = await screen.findByRole("option", { name: /Để sau/ });
    expect(option.className).toContain("pointer-coarse:min-h-11");
  });
});
