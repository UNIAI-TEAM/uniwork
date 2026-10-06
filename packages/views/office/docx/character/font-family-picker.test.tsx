import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FontFamilyPicker } from "./font-family-picker";

describe("FontFamilyPicker trigger", () => {
  it("is at least 140px wide and shows the resolved default family", () => {
    render(<FontFamilyPicker value={null} defaultFamily="Calibri" documentFonts={[]} onPick={() => {}} />);
    const trigger = screen.getByTestId("docx-font-family");
    expect(trigger.className).toMatch(/\b(w-36|min-w-36)\b/);
    expect(trigger.textContent).toContain("Calibri");
    expect(trigger.getAttribute("aria-label")).toBeTruthy();
  });

  it("prefers the explicit run font over the default family", () => {
    render(<FontFamilyPicker value="Arial" defaultFamily="Calibri" documentFonts={[]} onPick={() => {}} />);
    expect(screen.getByTestId("docx-font-family").textContent).toContain("Arial");
  });
});
