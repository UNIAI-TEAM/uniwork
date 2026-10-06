"use client";

// Data > Data Tools in Excel's order: Remove Duplicates, then the Data
// Validation group (owned by the DV/CF lane, mounted verbatim).

import { XlsxDataValidationGroup } from "../../data-validation/data-validation-group";
import { XlsxGroupBody } from "../group-layout";
import type { XlsxToolbarGroupProps } from "../types";
import { XlsxRemoveDuplicatesButton } from "./remove-duplicates-dialog";

export function XlsxDataToolsGroup(context: XlsxToolbarGroupProps) {
  return (
    <XlsxGroupBody>
      <XlsxRemoveDuplicatesButton {...context} />
      <XlsxDataValidationGroup {...context} />
    </XlsxGroupBody>
  );
}
