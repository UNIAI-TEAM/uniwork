"use client";

// Design review X1: Home > Styles in Excel's order - Conditional Formatting,
// Format as Table, Cell Styles - as three large commands. Conditional
// Formatting keeps its own items (the CF group owns its menu and dialogs);
// Format as Table creates a table over the selection through the same
// allowlisted `add-table` as Insert > Table (the default table look: the
// engine has no table-style write path, so there is no style gallery yet).

import { TableProperties } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RibbonItem } from "../../ribbon";
import { xlsxConditionalFormatRibbonItems } from "../conditional-format/conditional-format-group";
import { XlsxCellStylesMenu } from "./cell-styles";
import { XlsxGroupBody, XlsxLargeButton, XlsxLargeLabel } from "./group-layout";
import { selectionSpan } from "./structure-insert";
import { createTableOverSelection } from "./table-group";
import type { XlsxToolbarGroupProps } from "./types";

function XlsxFormatAsTable(context: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const label = t("office.xlsx.styles.formatAsTable");
  const blocked = context.readOnly === true || !context.commands || !selectionSpan(context.selection);
  return (
    <XlsxGroupBody>
      <XlsxLargeButton
        aria-label={label}
        title={label}
        aria-disabled={blocked || undefined}
        data-testid="xlsx-format-as-table"
        onClick={() => { if (!blocked) createTableOverSelection(context); }}
      >
        <TableProperties aria-hidden />
        <XlsxLargeLabel>{label}</XlsxLargeLabel>
      </XlsxLargeButton>
    </XlsxGroupBody>
  );
}

/** Estimated full-size width of one large Styles command (max-w-24). */
const LARGE_WIDTH = 96;

export function xlsxStylesRibbonItems(context: XlsxToolbarGroupProps): readonly RibbonItem[] {
  return [
    ...xlsxConditionalFormatRibbonItems(context),
    {
      kind: "custom",
      id: "format-as-table",
      labelKey: "office.xlsx.styles.formatAsTable",
      size: "large",
      collapseAs: "large",
      width: LARGE_WIDTH,
      render: () => <XlsxFormatAsTable {...context} />,
    },
    {
      kind: "custom",
      id: "cell-styles",
      labelKey: "office.xlsx.styles.cellStyles",
      size: "large",
      collapseAs: "large",
      width: LARGE_WIDTH,
      render: () => <XlsxCellStylesMenu {...context} />,
    },
  ];
}
