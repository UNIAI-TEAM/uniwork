"use client";

import { Paintbrush } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { XlsxToolbarGroupProps } from "../types";

/** The pinned Univer format painter (sheets-ui `FormatPainterService`).
 *
 *  Arm/cancel runs the synchronous `set-format-painter` operation
 *  (`FormatPainterStatus`: 1 = apply once on the next selection end, 0 = off).
 *  The operation is used instead of its `set-once-format-painter` command
 *  wrapper because the wrappers are async handlers, and the renderer's
 *  synchronous command port throws on those.
 *
 *  The capture happens when the status changes (the sheets-ui
 *  `FormatPainterController` hook snapshots the current selection styles); the
 *  sheets-ui render controller then executes `sheet.command.apply-format-painter`
 *  on the next selection end and toggles the one-shot mode off with
 *  `sheet.command.set-once-format-painter`. Both ids are allowlisted, and the
 *  style writes themselves ride the already-allowlisted
 *  `sheet.mutation.set-range-values` journal path — no second save path. */
export const XLSX_FORMAT_PAINTER_OPERATION = "sheet.operation.set-format-painter";
export const XLSX_FORMAT_PAINTER_ONCE = 1;
export const XLSX_FORMAT_PAINTER_OFF = 0;

/** Home > format painter: capture the current selection, apply to the next
 *  one; a second press or Escape cancels. Read-only disables it. */
export function XlsxFormatPainterGroup({ readOnly = false, canFormat, commands, selection }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !canFormat || !commands;
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  // One-shot mode: the render controller applies on the next selection change
  // and turns the mode off itself; the editor passes that selection here, so
  // the mirror clears with the same change. A change the renderer never
  // applied (sheet switch, selection update without a render apply) leaves it
  // armed behind the cleared mirror, so send the explicit off reset too.
  useEffect(() => {
    if (armedRef.current) {
      commands?.execute(XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF });
    }
    armedRef.current = false;
    setArmed(false);
  }, [selection, commands]);

  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      commands?.execute(XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF });
      armedRef.current = false;
      setArmed(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [armed, commands]);

  const toggle = () => {
    if (blocked) return;
    const next = !armed;
    const executed = commands?.execute(XLSX_FORMAT_PAINTER_OPERATION, {
      status: next ? XLSX_FORMAT_PAINTER_ONCE : XLSX_FORMAT_PAINTER_OFF,
    });
    if (executed) {
      armedRef.current = next;
      setArmed(next);
    }
  };

  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      aria-label={t("office.xlsx.toolbar.groups.painter.label")}
      title={t("office.xlsx.toolbar.groups.painter.hint")}
      aria-pressed={armed}
      aria-disabled={blocked || undefined}
      data-testid="xlsx-format-painter"
      onClick={toggle}
    >
      <Paintbrush aria-hidden />
    </Button>
  );
}
