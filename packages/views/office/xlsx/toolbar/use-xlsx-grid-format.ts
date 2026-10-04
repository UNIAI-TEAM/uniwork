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
      const result = gridRef.current?.executeCommand(id, params) ?? false;
      // The live renderer dispatches through the async Univer command service,
      // so the handle hands back a promise; refresh the mirror once it resolves.
      // A synchronous handle (test double) keeps the old inline behaviour.
      if (result instanceof Promise) {
        void result.then((executed) => {
          if (executed) refreshFormatState();
        });
      } else if (result) {
        refreshFormatState();
      }
      return result;
    },
  }), [gridRef, refreshFormatState]);
  return { formatState, refreshFormatState, commands };
}
