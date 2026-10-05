"use client";

import { Paintbrush } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { useViewEcho } from "../view-echo";
import type { XlsxToolbarGroupProps } from "../types";
import { XLSX_ICON_BUTTON_CLASS } from "../group-layout";

/** The pinned Univer format painter (sheets-ui `FormatPainterService`).
 *
 *  Arm/cancel runs the `set-format-painter` operation
 *  (`FormatPainterStatus`: 1 = apply once on the next selection end, 0 = off).
 *  The operation is used instead of its `set-once-format-painter` command
 *  wrapper because the operation has no policy wrapper of its own and the
 *  one-shot mode is applied by the sheets-ui render controller; the port now
 *  resolves the async result, so the mirror arms only on a resolved true.
 *
 *  The capture happens when the status changes (the sheets-ui
 *  `FormatPainterController` hook snapshots the current selection styles); the
 *  sheets-ui render controller then executes `sheet.command.apply-format-painter`
 *  on the next selection end and toggles the one-shot mode off with
 *  `sheet.command.set-once-format-painter`. Both ids are allowlisted, and the
 *  style writes themselves ride the already-allowlisted
 *  `sheet.mutation.set-range-values` journal path - no second save path.
 *
 *  Chrome amendment R (UNI-926 fix r2): the armed mirror is owned by the
 *  TOOLBAR (`viewEcho.painterArmed`), not by this group. The ribbon mounts only
 *  the active tab's groups, and Excel keeps the painter armed across tab
 *  switches, so a group-local mirror would reset to "off" while the engine
 *  stayed armed. Nothing runs on unmount: the engine mode is intentionally
 *  left alone, exactly like the pre-ribbon shell that kept every panel
 *  mounted. */
export const XLSX_FORMAT_PAINTER_OPERATION = "sheet.operation.set-format-painter";
export const XLSX_FORMAT_PAINTER_ONCE = 1;
export const XLSX_FORMAT_PAINTER_OFF = 0;

/** Home > Clipboard > format painter (an icon item of that group): capture the current selection, apply to the next
 *  one; a second press or Escape cancels. Read-only disables it. */
export function XlsxFormatPainterButton({ readOnly = false, canFormat, commands, selection, viewEcho }: XlsxToolbarGroupProps) {
  const { t } = useTranslation();
  const blocked = readOnly || !canFormat || !commands;
  const echo = useViewEcho(viewEcho);
  const armed = echo.painterArmed;

  // The selection the mount first saw. A remount after a ribbon tab switch
  // must NOT disarm the engine (Excel keeps it armed); only a selection change
  // that happens while this mount is alive does.
  const selectionKey = selection ? `${selection.sheet}!${selection.address}` : null;
  const lastSelectionRef = useRef(selectionKey);

  // One-shot mode: the render controller applies on the next selection change
  // and turns the mode off itself; the editor passes that selection here, so
  // the mirror clears with the same change. A change the renderer never
  // applied (sheet switch, selection update without a render apply) leaves it
  // armed behind the cleared mirror, so send the explicit off reset too.
  useEffect(() => {
    if (lastSelectionRef.current === selectionKey) return;
    lastSelectionRef.current = selectionKey;
    if (echo.painterArmed) {
      // Fire-and-forget reset: rejections resolve false at the port, and this
      // path only clears local mirror state regardless of the outcome.
      void Promise.resolve(commands?.execute(XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF })).catch(() => false);
      echo.setPainterArmed(false);
    }
  }, [selectionKey, commands, echo]);

  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      void Promise.resolve(commands?.execute(XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF })).catch(() => false);
      echo.setPainterArmed(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [armed, commands, echo]);

  const toggle = () => {
    if (blocked) return;
    const next = !armed;
    // Arm the mirror only once the port confirms the command ran; a resolved
    // false (read-only flip, policy refusal) or a rejection leaves it unarmed
    // so the mirror never diverges from the renderer.
    void Promise.resolve(commands?.execute(XLSX_FORMAT_PAINTER_OPERATION, {
      status: next ? XLSX_FORMAT_PAINTER_ONCE : XLSX_FORMAT_PAINTER_OFF,
    })).then((executed) => {
      if (executed) echo.setPainterArmed(next);
    }).catch(() => false);
  };

  return (
    <Button
      type="button"
      variant="toolbar"
      size="icon-sm"
      className={XLSX_ICON_BUTTON_CLASS}
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