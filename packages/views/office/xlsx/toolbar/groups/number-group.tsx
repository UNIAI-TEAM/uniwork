"use client";

import { XlsxNumberFormatGroup } from "../../number-format/number-format-group";
import type { XlsxToolbarGroupProps } from "../types";

/** Registry-facing name for the Home number-format group. The controls live in
 *  `xlsx/number-format/` so the gallery catalog, validation and command guard
 *  stay one folder; this file keeps the registry seam's import unchanged. */
export function XlsxNumberGroup(props: XlsxToolbarGroupProps) {
  return <XlsxNumberFormatGroup {...props} />;
}
