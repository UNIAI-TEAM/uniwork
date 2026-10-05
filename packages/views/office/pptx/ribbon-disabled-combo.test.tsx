import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { TooltipProvider } from "@uniwork/ui/components/ui/tooltip";
import { PptxDisabledCombo } from "./ribbon-disabled-combo";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

describe("PptxDisabledCombo", () => {
  it("is focusable and exposes the reason as its accessible description", () => {
    render(
      <TooltipProvider>
        <PptxDisabledCombo
          labelKey="office.pptx.text.format.font_family"
          reasonKey="office.pptx.text.format.empty"
          width={140}
          value={null}
          options={[{ value: "Arial", label: "Arial" }]}
        />
      </TooltipProvider>,
    );
    const control = screen.getByRole("group", { name: "Font" });
    expect(control).toHaveAttribute("tabindex", "0");
    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(control).toHaveAccessibleDescription(/\S/);
    control.focus();
    expect(control).toHaveFocus();
  });
});
