import { Square } from "lucide-react";
import type { RibbonItem } from "../../ribbon";
import type { XlsxToolbarGroupProps } from "./types";
import { fireCommand } from "../fire-command";

/** Pinned Univer BorderType / BorderStyleTypes values; a thin black stroke is
 *  the Excel default the presets apply. */
const BORDER_STYLE_THIN = 1;
const BORDER_COLOR = "#000000";
/** Excel's Borders button applies the bottom border by default. */
const BORDER_DEFAULT = "bottom";
const BORDER_PRESETS = [
  { key: "all", type: "all" },
  { key: "outside", type: "outside" },
  { key: "none", type: "none" },
] as const;
const BORDER_EDGES = [
  { key: "edgeTop", type: "top" },
  { key: "edgeRight", type: "right" },
  { key: "edgeBottom", type: "bottom" },
  { key: "edgeLeft", type: "left" },
] as const;

/** Home > Font > Borders split: the primary applies the bottom border, the
 *  menu lists the presets plus the four individual edges. Border state is not
 *  mirrored (the composed border of a range has no single cheap control
 *  state); the item stays stateless. */
export function xlsxBordersRibbonItem({ readOnly = false, canFormat, commands }: XlsxToolbarGroupProps): RibbonItem {
  const blocked = readOnly || !canFormat || !commands;
  const run = (type: string) => {
    if (blocked) return;
    fireCommand(commands, "sheet.command.set-border-basic", {
      value: { type, style: BORDER_STYLE_THIN, color: BORDER_COLOR },
    });
  };
  return {
    kind: "split",
    id: "font-borders",
    labelKey: "office.xlsx.toolbar.groups.borders.label",
    icon: Square,
    size: "icon",
    collapseAs: "icon",
    disabled: blocked,
    onExecute: () => run(BORDER_DEFAULT),
    menu: [...BORDER_PRESETS, ...BORDER_EDGES].map(({ key, type }) => ({
      id: `border-${type}`,
      labelKey: `office.xlsx.toolbar.groups.borders.${key}`,
      disabled: blocked,
      onSelect: () => run(type),
    })),
  };
}
