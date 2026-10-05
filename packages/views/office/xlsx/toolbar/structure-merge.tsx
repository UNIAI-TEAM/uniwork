import { TableCellsMerge } from "lucide-react";
import type { RibbonItem } from "../../ribbon";
import { selectionSpan } from "./structure-insert";
import { XLSX_HORIZONTAL_ALIGN } from "./home-format";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";

/** The pinned Univer merge commands this item wires. Merge-all takes the
 *  whole selection as one merge; merge-horizontal is "merge across" (one
 *  merge per row of the selection, which the pinned command expands from the
 *  live selection); remove-worksheet-merge removes every merge the passed
 *  ranges intersect. All three are allowlisted in the renderer's command
 *  policy; the save journals them as `merge_cells`/`unmerge_cells` ops. */
export const XLSX_MERGE_ALL_COMMAND = "sheet.command.add-worksheet-merge-all";
export const XLSX_MERGE_ACROSS_COMMAND = "sheet.command.add-worksheet-merge-horizontal";
export const XLSX_UNMERGE_COMMAND = "sheet.command.remove-worksheet-merge";

const HORIZONTAL_ALIGN_COMMAND = "sheet.command.set-horizontal-text-align";

/** Home > Alignment > "Merge & center" split. The primary merges the selection
 *  and centres it (merge-all + the existing horizontal-align command); the
 *  menu offers merge cells / merge across / unmerge. Without a selection, or
 *  with a single cell, there is nothing to merge or unmerge, so the item is
 *  `aria-disabled` - never hidden; read-only and a missing commands port
 *  disable it the same way. Merge across is additionally disabled on a
 *  single-column selection, where each row would merge into itself (the pinned
 *  command filters those selections out - the entry would be dead). The params
 *  mirror the selection for the policy gate and for unmerge (whose command
 *  reads `ranges`); the pinned merge family expands the live selection. */
export function xlsxMergeRibbonItem({ readOnly = false, selection, commands }: XlsxToolbarGroupProps): RibbonItem {
  const span = selectionSpan(selection);
  const blocked = readOnly || !commands || span === null || (span.rows === 1 && span.columns === 1);
  const acrossBlocked = blocked || (span !== null && span.columns === 1);
  const range = span === null
    ? null
    : { startRow: span.startRow, endRow: span.endRow, startColumn: span.startColumn, endColumn: span.endColumn };
  const selections = range === null ? [] : [range];

  const run = (inert: boolean, id: string, params: unknown) => {
    if (inert) return;
    fireCommand(commands, id, params);
  };

  return {
    kind: "split",
    id: "align-merge",
    labelKey: "office.xlsx.structure.mergeCenter",
    icon: TableCellsMerge,
    size: "icon",
    collapseAs: "icon",
    disabled: blocked,
    onExecute: () => {
      run(blocked, XLSX_MERGE_ALL_COMMAND, { selections });
      run(blocked, HORIZONTAL_ALIGN_COMMAND, { value: XLSX_HORIZONTAL_ALIGN.center });
    },
    menu: [
      {
        id: "merge-cells",
        labelKey: "office.xlsx.structure.mergeCells",
        disabled: blocked,
        onSelect: () => run(blocked, XLSX_MERGE_ALL_COMMAND, { selections }),
      },
      {
        id: "merge-across",
        labelKey: "office.xlsx.structure.mergeAcross",
        disabled: acrossBlocked,
        onSelect: () => run(acrossBlocked, XLSX_MERGE_ACROSS_COMMAND, { selections }),
      },
      {
        id: "unmerge-cells",
        labelKey: "office.xlsx.structure.unmergeCells",
        disabled: blocked,
        onSelect: () => run(blocked, XLSX_UNMERGE_COMMAND, { ranges: selections }),
      },
    ],
  };
}
