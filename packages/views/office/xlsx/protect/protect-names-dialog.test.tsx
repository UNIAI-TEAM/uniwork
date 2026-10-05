import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XlsxProtectNamesDialog } from "./protect-names-dialog";

function renderDialog() {
  render(
    <XlsxProtectNamesDialog
      definedNames={[{ name: "Sales", formula: "Sheet1!$A$1:$B$2" }]}
      sheetNames={["Data", "Tổng hợp"]}
      onSetProtection={vi.fn()}
      onApplyNames={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("XlsxProtectNamesDialog layout", () => {
  it("keeps the name and reference inputs readable in a wrapping row", () => {
    renderDialog();
    const row = screen.getByTestId("xlsx-name-row");
    // The row wraps at narrow widths instead of squeezing the two inputs.
    expect(row).toHaveClass("flex-wrap");
    // Name >= 8rem, reference >= 10rem so both stay readable and editable.
    expect(screen.getByLabelText(viLocale.office.xlsx.protect.dialog.name)).toHaveClass("min-w-32");
    expect(screen.getByLabelText(viLocale.office.xlsx.protect.dialog.formula)).toHaveClass("min-w-40");
    // The scope select and the Remove button keep a fixed size.
    expect(screen.getByTestId("xlsx-name-scope")).toHaveClass("w-48", "shrink-0");
    expect(screen.getByRole("button", { name: viLocale.office.xlsx.protect.dialog.remove })).toHaveClass("shrink-0");
    // The dialog body scrolls vertically when the name list grows.
    expect(screen.getByTestId("xlsx-protect-names-body")).toHaveClass("overflow-y-auto");
  });
});
