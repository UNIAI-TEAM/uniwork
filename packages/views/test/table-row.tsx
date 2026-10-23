// A stand-in table row that reproduces the table's real open-task handler, shared by the picker tests.
import { render } from "@testing-library/react";
import type { MouseEvent, ReactElement } from "react";
import { vi } from "vitest";
import { isRowControlTarget } from "../tasks/modes/row-navigation";

/**
 * Renders `ui` inside a stand-in for a DataTable row wired like table-view's
 * `onRowClick`: the row bails on `defaultPrevented` exactly like DataTable
 * (packages/ui/components/ui/data-table.tsx), forwards only middle-button
 * aux-clicks, then applies the shared row-control filter.
 *
 * `rowControlFilter: false` drops the filter so a test proves a picker's own
 * guard rather than the table's selector.
 */
export function renderInTableRow(
  ui: ReactElement,
  {
    wrapper = (node) => node,
    rowControlFilter = true,
  }: {
    wrapper?: (node: ReactElement) => ReactElement;
    rowControlFilter?: boolean;
  } = {},
) {
  const onOpenRow = vi.fn<(eventType: string) => void>();
  const open = (event: MouseEvent) => {
    if (rowControlFilter && isRowControlTarget(event.target)) return;
    onOpenRow(event.type);
  };
  const result = render(
    wrapper(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stands in for DataTable's row wrapper; child control is interactive
      <div
        data-testid="table-row"
        onClick={(event) => {
          if (event.defaultPrevented) return;
          open(event);
        }}
        onAuxClick={(event) => {
          if (event.defaultPrevented || event.button !== 1) return;
          event.preventDefault();
          open(event);
        }}
      >
        {ui}
      </div>,
    ),
  );
  return { ...result, onOpenRow };
}
