"use client";

import { createContext, useContext } from "react";

/** Closes the dropdown panel a collapsed ribbon group opens, so a one-shot
 *  command run from a menu nested in that panel (Home > Cells > Insert) does
 *  not leave the panel hanging open. A no-op outside a panel. */
const RibbonPanelCloseContext = createContext<() => void>(() => undefined);

export const RibbonPanelCloseProvider = RibbonPanelCloseContext.Provider;

export function useRibbonPanelClose(): () => void {
  return useContext(RibbonPanelCloseContext);
}
