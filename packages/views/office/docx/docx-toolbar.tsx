"use client";

import { DocxToolbarShell } from "./toolbar/toolbar";
import type { DocxToolbarProps } from "./toolbar/types";

/** Stable entry point for hosts (index.ts re-exports it): the tabbed shell in
 * ./toolbar/ owns the layout, this keeps the published name working. */
export function DocxToolbar(props: DocxToolbarProps) {
  return <DocxToolbarShell {...props} />;
}
