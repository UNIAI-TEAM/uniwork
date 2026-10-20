import { StrictMode, useLayoutEffect, useRef, useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AccessReportSortHeader, type PendingSortFocus } from "./access-report-sort-header";

// The sortable column header (UNI-2039 F3, the UNI-2038 markup): aria-sort on
// the th, a button named "Sort by {column}", the arrow only on the sorted
// column, a new column at its own default order and the same one flipped.

const { t } = initI18n();

type Sort = { sort: "changed" | "title"; order: "asc" | "desc" };

/** The pair of headers with the pending-focus ref the table would own. */
function Headers({ sort, order, onSortChange }: Sort & { onSortChange: (next: Sort) => void }) {
  const pendingFocus = useRef<PendingSortFocus | null>(null);
  return (
    <>
      <table>
        <thead>
          <tr>
            <AccessReportSortHeader column="title" label="Tài liệu" sort={sort} order={order} onSortChange={onSortChange} pendingFocus={pendingFocus} />
            <AccessReportSortHeader column="changed" label="Thay đổi gần nhất" sort={sort} order={order} onSortChange={onSortChange} pendingFocus={pendingFocus} />
          </tr>
        </thead>
      </table>
      <input aria-label="Tìm kiếm" />
    </>
  );
}

function renderHeaders(sort: Sort["sort"], order: Sort["order"], onSortChange = vi.fn()) {
  const view = render(<Headers sort={sort} order={order} onSortChange={onSortChange} />);
  return Object.assign(onSortChange, { rerender: (next: Sort) => view.rerender(<Headers {...next} onSortChange={onSortChange} />) });
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
      const pendingFocus = useRef<PendingSortFocus | null>(null);
      const [state, setState] = useState<Sort>({ sort: "changed", order: "desc" });
      useLayoutEffect(() => {
        if (steal) (document.activeElement as HTMLElement | null)?.blur();
      }, [state, steal]);
      return (
        <table>
          <thead>
            <tr key={remount ? `${state.sort}:${state.order}` : "row"}>
              <AccessReportSortHeader column="title" label="Tài liệu" {...state} onSortChange={setState} pendingFocus={pendingFocus} />
              <AccessReportSortHeader column="changed" label="Thay đổi gần nhất" {...state} onSortChange={setState} pendingFocus={pendingFocus} />
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

    it("keeps its one-frame fallback under StrictMode's double effect", async () => {
      const user = userEvent.setup();
      render(
        <StrictMode>
          <Harness remount steal />
        </StrictMode>,
      );
      await user.tab();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(button("Tài liệu")).toHaveFocus());
    });
  });

  describe("never takes focus it was not owed", () => {
    it("leaves focus alone when the user moved on before the new order rendered", () => {
      const view = renderHeaders("changed", "desc");
      const press = button("Tài liệu");
      press.focus();
      fireEvent.click(press);
      const search = screen.getByRole("textbox", { name: "Tìm kiếm" });
      search.focus();
      view.rerender({ sort: "title", order: "asc" });
      expect(search).toHaveFocus();
    });

    it("does not focus a header after a sort change nobody pressed", () => {
      const view = renderHeaders("changed", "desc");
      view.rerender({ sort: "title", order: "asc" });
      expect(document.body).toHaveFocus();
    });

    it("never moves focus to the other column's header", () => {
      const view = renderHeaders("changed", "desc");
      fireEvent.click(button("Tài liệu"));
      view.rerender({ sort: "title", order: "asc" });
      expect(button("Tài liệu")).toHaveFocus();
      expect(button("Thay đổi gần nhất")).not.toHaveFocus();
    });

    it("forgets a press the new order never answered", () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const view = renderHeaders("changed", "desc");
        fireEvent.click(button("Tài liệu"));
        act(() => {
          vi.advanceTimersByTime(3001);
        });
        view.rerender({ sort: "title", order: "asc" });
        expect(document.body).toHaveFocus();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
