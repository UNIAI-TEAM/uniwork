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
// A variant prefix (`pointer-coarse:py-2`) counts too, but `after:` utilities
// only shape the invisible hit area and never the box itself.
const OVERSIZE = /(^|\s|:)(-?m[tby]-|p[tby]-(?!0\b)|h-(?!4\b)|min-h-|leading-)/;
const boxClasses = (el: HTMLElement) =>
  el.className
    .split(/\s+/)
    .filter((cls) => !cls.includes("after:"))
    .join(" ");

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
      expect(boxClasses(el)).not.toMatch(OVERSIZE);
      expect(el.className).not.toContain("calc(");
    }
  });

  it("gives coarse pointers a full-height hit area beside the grip and resize handle", () => {
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
    const classes = trigger.className.split(/\s+/);
    // Coarse pointers only: fine pointers keep the 16px box and no pseudo-element.
    expect(classes.filter((cls) => cls.includes("after:") && !cls.startsWith("pointer-coarse:"))).toEqual([]);
    expect(classes).toEqual(
      expect.arrayContaining([
        "pointer-coarse:after:absolute",
        "pointer-coarse:after:inset-y-0",
        // Clear of the grip's 44px coarse hit area and the 8px resize handle.
        "pointer-coarse:after:left-11",
        "pointer-coarse:after:right-2",
      ]),
    );
    // The pseudo-element must be positioned against the header cell: a
    // positioned ancestor below the th (or the trigger itself) would make it
    // one line tall, and DataTable's overflow-hidden label span would clip it.
    for (let el: HTMLElement | null = trigger; el && el.tagName !== "TH"; el = el.parentElement) {
      expect(el.className.split(/\s+/)).not.toContain("relative");
    }
  });
});
