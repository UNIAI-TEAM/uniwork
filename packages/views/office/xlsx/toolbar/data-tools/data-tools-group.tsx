"use client";

// Data > Data Tools in Excel's order: Text to Columns, Remove Duplicates, then the Data
// Validation group (owned by the DV/CF lane, mounted verbatim).

import { XlsxDataValidationGroup } from "../../data-validation/data-validation-group";
import { XlsxGroupBody } from "../group-layout";
import type { XlsxToolbarGroupProps } from "../types";
import { XlsxRemoveDuplicatesButton } from "./remove-duplicates-dialog";
import { XlsxTextToColumnsButton } from "./text-to-columns-dialog";

export function XlsxDataToolsGroup(context: XlsxToolbarGroupProps) {
  return (
    <XlsxGroupBody>
      <XlsxTextToColumnsButton {...context} />
      <XlsxRemoveDuplicatesButton {...context} />
      <XlsxDataValidationGroup {...context} />
    </XlsxGroupBody>
  );
}
