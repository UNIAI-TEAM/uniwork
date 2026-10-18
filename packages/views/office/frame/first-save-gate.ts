import type { SaveResult } from "@uniwork/core/office/docs-frame-protocol";
import { FIRST_SAVE_DECLINED, type FirstSaveNamer } from "./docs-frame-session-model";

/**
 * UNI-1847 (SAVE-01): the one place a session decides whether a save may run as
 * sent or must name the document first - a never-saved blank (`untitled.<ext>`
 * at version 1, per `firstSave.needsName`) the user may edit. Both save entry
 * points use it:
 *
 * - A page Save asks inline: the name written, the same save carries on
 *   (`pageAsk`); Cancel answers "cancelled" and sends nothing.
 * - A frame `api.save` is declined at once (`frameAsk`) with the protocol's own
 *   cancelled shape - the name dialog may stay open for hours and the frame's
 *   120 s answer timeout could never fire otherwise - while the page names the
 *   document, then issues the Save itself.
 *
 * `savedOnce` (the session's own ref) covers documents whose first save already
 * happened; `namedOnce` latches a dialog answer so a later save never asks
 * again even when the save that followed it failed.
 */
export interface FirstSaveGate {
  /** The open save must name the document first, or null when it may run as sent. */
  pendingName: () => FirstSaveNamer | null;
  /** Naming for a page Save: resolves false on Cancel, true once named - and latches it. */
  pageAsk: (namer: FirstSaveNamer) => Promise<boolean>;
  /** Naming for a declined frame save: latches the name, then issues the page's Save. */
  frameAsk: (namer: FirstSaveNamer, reissue: () => void) => void;
  /** A frame `api.save` of an unnamed blank: the answer to give at once (null when it may run), the naming started. */
  declineFrameSave: (reissue: () => void) => SaveResult | null;
  /**
   * A naming dialog this gate opened is still unsettled (UNI-1901): the wait counts
   * as a save in flight, so a `close_requested` Esc is ignored while it is open.
   */
  asking: () => number;
  /** A fresh session (retry, another document) asks again for its own blank. */
  reset: () => void;
}

export function createFirstSaveGate(opts: {
  /** Session state read live: `readonly` now, `savedOnce` when the document already saved. */
  current: () => { firstSave?: FirstSaveNamer; viewOnly: boolean; savedOnce: boolean };
}): FirstSaveGate {
  let namedOnce = false;
  // Unsettled namer.ask() calls this gate opened. Deliberately not reset(): a dialog that
  // outlives its session still sits on the page, so its close must stay blocked until it
  // settles - mirroring the per-session `saves` counter that never takes a late decrement.
  let asking = 0;
  const ask = (namer: FirstSaveNamer): Promise<boolean> => {
    asking += 1;
    return namer.ask().finally(() => { asking = Math.max(0, asking - 1); });
  };
  const gate: FirstSaveGate = {
    pendingName: () => {
      const { firstSave, viewOnly, savedOnce } = opts.current();
      return firstSave && !savedOnce && !namedOnce && !viewOnly && firstSave.needsName() ? firstSave : null;
    },
    pageAsk: async (namer) => (await ask(namer)) ? (namedOnce = true) : false,
    frameAsk: (namer, reissue) => {
      void ask(namer).then((named) => { if (named) { namedOnce = true; reissue(); } });
    },
    declineFrameSave: (reissue) => {
      const namer = gate.pendingName();
      if (!namer) return null;
      gate.frameAsk(namer, reissue);
      return FIRST_SAVE_DECLINED;
    },
    asking: () => asking,
    reset: () => { namedOnce = false; },
  };
  return gate;
}
