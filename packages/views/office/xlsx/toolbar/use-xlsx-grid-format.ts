"use client";

import { useCallback, useMemo, useState, type RefObject } from "react";
import type { XlsxGridFormatState, XlsxGridHandle } from "../xlsx-grid-surface";
import type { XlsxToolbarCommands } from "./types";

/** Mirrors the active-selection style out of the mounted renderer and builds
 *  the toolbar's one command port. The editor keeps a single call site for
 *  both; the port refreshes the mirror whenever a command actually ran, and
 *  the editor refreshes on ready, selection and journal edits. */
export function useXlsxGridFormat(gridRef: RefObject<XlsxGridHandle | null>): {
  formatState: XlsxGridFormatState | null;
  refreshFormatState: () => void;
  commands: XlsxToolbarCommands;
} {
  const [formatState, setFormatState] = useState<XlsxGridFormatState | null>(null);
  const refreshFormatState = useCallback(() => {
    setFormatState(gridRef.current?.getActiveFormatState() ?? null);
  }, [gridRef]);
  const commands = useMemo<XlsxToolbarCommands>(() => ({
    execute: (id, params) => {
      // The port is the one normalisation point: the live renderer dispatches
      // through the async Univer command service (a Promise that resolves true
      // only when the command actually ran), while a synchronous test double
      // hands back a plain boolean. Both are folded into a single
      // resolved-boolean Promise here, and a rejected or synchronously thrown
      // dispatch (unregistered id, handler error) resolves false so no caller
      // ever sees an unhandled rejection. The mirror refreshes only on a run.
      let dispatched: boolean | Promise<boolean>;
      try {
        dispatched = gridRef.current?.executeCommand(id, params) ?? false;
      } catch {
        dispatched = false;
      }
      const result = Promise.resolve(dispatched).catch(() => false);
      void result.then((executed) => {
        if (executed) refreshFormatState();
      });
      return result;
    },
    readRuleSets: (sheetId, family) => gridRef.current?.readRuleSets?.(sheetId, family) ?? null,
    executeAsOneStep: (steps, options) => {
      const grid = gridRef.current;
      if (!grid?.executeCommandsAsOneStep) return Promise.resolve(false);
      // The grid reports either a boolean or (paste-x06) how many steps
      // completed; only a fully completed batch counts as run.
      const result = Promise.resolve(grid.executeCommandsAsOneStep(steps, options?.atomic ? { rollback: true } : undefined) as Promise<unknown>)
        .then((outcome) => (typeof outcome === "number" ? outcome === steps.length : outcome === true))
        .catch(() => false);
      void result.then((executed) => {
        if (executed) refreshFormatState();
      });
      return result;
    },
  }), [gridRef, refreshFormatState]);
  return { formatState, refreshFormatState, commands };
}
