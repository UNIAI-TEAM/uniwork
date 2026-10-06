"use client";

import { useMemo, useState } from "react";
import { clampZoom, XLSX_ZOOM_DEFAULT } from "../view/zoom";

/** Absolute zoom command: `{ zoomRatio }` in ratio units. Preferred over the
 *  relative `change-zoom-ratio` delta because it cannot drift when the echo is
 *  stale (e.g. right after a ribbon tab switch). */
export const XLSX_ZOOM_SET_COMMAND = "sheet.command.set-zoom-ratio";

/** The absolute `set-zoom-ratio` params that land the renderer on `percent`,
 *  independent of whatever zoom the control last echoed. */
export function zoomRatioTarget(percent: number): { zoomRatio: number } {
  return { zoomRatio: clampZoom(percent) / 100 };
}

/**
 * Local echoes of renderer view state that the command port cannot read back.
 *
 * Chrome amendment R (UNI-926 fix r2): the shared ribbon mounts ONLY the
 * active tab's groups, so a `useState` echo living inside a group component is
 * destroyed on every tab switch while the renderer keeps its state. The
 * toolbar owns this echo once and passes it down through
 * `XlsxToolbarGroupProps.viewEcho`, so the echoes outlive the per-tab group
 * mounts exactly like the pre-ribbon shell (which kept all six panels mounted)
 * did.
 */
export interface XlsxViewEcho {
  /** View > zoom: the percent the renderer is showing. */
  zoomPercent: number;
  setZoomPercent: (percent: number) => void;
  /** View > display: the gridline/header visibility the renderer holds. */
  gridlines: boolean;
  setGridlines: (visible: boolean) => void;
  headers: boolean;
  setHeaders: (visible: boolean) => void;
  /** Home > format painter: whether the one-shot mode is armed in the engine. */
  painterArmed: boolean;
  setPainterArmed: (armed: boolean) => void;
}

/** The hoisted echo state. Mounted once by the toolbar, which stays mounted
 *  for the whole session, so a tab switch can never reset it. */
export function useXlsxViewEcho(): XlsxViewEcho {
  const [zoomPercent, setZoomPercent] = useState(XLSX_ZOOM_DEFAULT);
  const [gridlines, setGridlines] = useState(true);
  const [headers, setHeaders] = useState(true);
  const [painterArmed, setPainterArmed] = useState(false);
  return useMemo(
    () => ({
      zoomPercent,
      setZoomPercent,
      gridlines,
      setGridlines,
      headers,
      setHeaders,
      painterArmed,
      setPainterArmed,
    }),
    [zoomPercent, gridlines, headers, painterArmed],
  );
}

/** A group's accessor: the hoisted echo when the toolbar provides one, else a
 *  component-local echo (a group rendered on its own, e.g. a unit test). */
export function useViewEcho(external?: XlsxViewEcho): XlsxViewEcho {
  const local = useXlsxViewEcho();
  return external ?? local;
}