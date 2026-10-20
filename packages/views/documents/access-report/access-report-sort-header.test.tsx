import { useLayoutEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AccessReportSortHeader } from "./access-report-sort-header";

// The sortable column header (UNI-2039 F3, the UNI-2038 markup): aria-sort on
// the th, a button named "Sort by {column}", the arrow only on the sorted
// column, a new column at its own default order and the same one flipped.

const { t } = initI18n();

function renderHeaders(sort: "changed" | "title", order: "asc" | "desc", onSortChange = vi.fn()) {
  render(
    <table>
      <thead>
        <tr>
          <AccessReportSortHeader column="title" label="Tài liệu" sort={sort} order={order} onSortChange={onSortChange} />
          <AccessReportSortHeader column="changed" label="Thay đổi gần nhất" sort={sort} order={order} onSortChange={onSortChange} />
        </tr>
      </thead>
    </table>,
  );
  return onSortChange;
}

const header = (label: string) => screen.getByRole("columnheader", { name: new RegExp(label) });
const button = (label: string) => screen.getByRole("button", { name: t("documents.accessReport.sort_by", { column: label }) });

describe("AccessReportSortHeader", () => {
  it("marks only the sorted column and draws its arrow", () => {
    renderHeaders("changed", "desc");
    expect(header("Thay đổi gần nhất")).toHaveAttribute("aria-sort", "descending");
    expect(header("Tài liệu")).toHaveAttribute("aria-sort", "none");
    expect(header("Thay đổi gần nhất").querySelector("svg")).not.toBeNull();
    expect(header("Tài liệu").querySelector("svg")).toBeNull();
  });

  it("reads ascending on an ascending column", () => {
    renderHeaders("title", "asc");
    expect(header("Tài liệu")).toHaveAttribute("aria-sort", "ascending");
  });

  it("sorts a new column in its default order: title ascending, last change descending", () => {
    const onSortChange = renderHeaders("changed", "desc");
    fireEvent.click(button("Tài liệu"));
    expect(onSortChange).toHaveBeenLastCalledWith({ sort: "title", order: "asc" });

    const second = vi.fn();
    document.body.innerHTML = "";
    renderHeaders("title", "asc", second);
    fireEvent.click(button("Thay đổi gần nhất"));
    expect(second).toHaveBeenLastCalledWith({ sort: "changed", order: "desc" });
  });

  it("flips the order on the sorted column", () => {
    const onSortChange = renderHeaders("changed", "desc");
    fireEvent.click(button("Thay đổi gần nhất"));
    expect(onSortChange).toHaveBeenLastCalledWith({ sort: "changed", order: "asc" });
  });

  describe("keyboard focus across a re-sort", () => {
    // A host that moves focus off the button when the URL changes (the router's
    // own focus handling), with the headers either kept or mounted anew.
    function Harness({ remount, steal }: { remount: boolean; steal: boolean }) {
      const [state, setState] = useState<{ sort: "changed" | "title"; order: "asc" | "desc" }>({ sort: "changed", order: "desc" });
      useLayoutEffect(() => {
        if (steal) (document.activeElement as HTMLElement | null)?.blur();
      }, [state, steal]);
      return (
        <table>
          <thead>
            <tr key={remount ? `${state.sort}:${state.order}` : "row"}>
              <AccessReportSortHeader column="title" label="Tài liệu" {...state} onSortChange={setState} />
              <AccessReportSortHeader column="changed" label="Thay đổi gần nhất" {...state} onSortChange={setState} />
            </tr>
          </thead>
        </table>
      );
    }

    it.each([
      ["stays mounted", false, false],
      ["is blurred by the host", false, true],
      ["is mounted anew", true, true],
    ])("keeps focus on the pressed header when the row %s", async (_name, remount, steal) => {
      const user = userEvent.setup();
      render(<Harness remount={remount} steal={steal} />);
      await user.tab();
      expect(button("Tài liệu")).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(header("Tài liệu")).toHaveAttribute("aria-sort", "ascending");
      await waitFor(() => expect(button("Tài liệu")).toHaveFocus());
      await user.keyboard("{Enter}");
      expect(header("Tài liệu")).toHaveAttribute("aria-sort", "descending");
      await waitFor(() => expect(button("Tài liệu")).toHaveFocus());
    });
  });
});
