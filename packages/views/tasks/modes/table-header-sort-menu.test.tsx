import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TableHeaderSortMenu } from "./table-header-sort-menu";

initI18n();

// DataTable's header cell is `h-8 py-2`: a 16px content box, and a reorderable
// column wraps the header in an overflow-hidden `block truncate` span of one
// 16px line. jsdom does no layout, so this pins the classes that decide it: a
// trigger taller than one line (vertical padding, a fixed height) or shifted
// by a negative margin grows the row past 32px and, inside that span, clips
// the top of the label — Vietnamese diacritics first.
const OVERSIZE = /(^|\s)(-?m[ty]-|p[ty]-(?!0\b)|h-(?!4\b)|min-h-)/;

describe("TableHeaderSortMenu", () => {
  it("fits one 16px line of the header cell", () => {
    render(
      <table>
        <thead>
          <tr>
            <th>
              <TableHeaderSortMenu
                columnKey="status"
                label="Trạng thái"
                sortField="status"
                sortBy="position"
                sortDirection="asc"
                onSort={vi.fn()}
                onHide={vi.fn()}
              />
            </th>
          </tr>
        </thead>
      </table>,
    );
    const trigger = screen.getByRole("button", { name: "Trạng thái" });
    const chain: HTMLElement[] = [];
    for (let el: HTMLElement | null = trigger; el && el.tagName !== "TH"; el = el.parentElement) {
      chain.push(el);
    }
    for (const el of chain) {
      expect(el.className).not.toMatch(OVERSIZE);
      expect(el.className).not.toContain("calc(");
    }
  });
});
