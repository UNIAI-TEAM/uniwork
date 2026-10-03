"use client";

import type { DocxToolbarGroupContext } from "./toolbar/types";
import { DocxStatusBar as DocxStatusBarView } from "./status";

/**
 * Editor-chrome slot: docx-editor.tsx mounts this with the shared toolbar
 * context. The bar is presentational, and the context carries the host
 * EditorHandle, which keeps the live TipTap document private (no counts or
 * language reader; the command runtime exposes none either), so counts and
 * language have no source yet and the wiring does not measure page x/y or
 * zoom — every readout renders its unknown mark. A later round that publishes
 * the live editor (the schema-extension store pattern the find layer uses) can
 * feed this adapter without changing the mount contract.
 */
export function DocxStatusBar(_context: DocxToolbarGroupContext) {
  return <DocxStatusBarView />;
}
