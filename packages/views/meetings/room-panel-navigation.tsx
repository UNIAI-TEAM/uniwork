"use client";
import { useMemo, type ReactNode } from "react";
import { NavigationProvider, navigateInternal, useOptionalNavigation, type NavigationAdapter } from "../navigation";

/**
 * Leaving the room's page drops the call, so a page the side panel opens (a
 * task, a document, a toast's "View") goes to a new tab; a change to the
 * room's own URL stays a push.
 */
export function RoomPanelNavigation({ children }: { children: ReactNode }) {
  const nav = useOptionalNavigation();
  const value = useMemo<NavigationAdapter | null>(
    () =>
      nav && {
        ...nav,
        push: (path: string) =>
          path.split(/[?#]/)[0] === nav.pathname ? nav.push(path) : navigateInternal(nav, path, "foreground-tab"),
      },
    [nav],
  );
  return value ? <NavigationProvider value={value}>{children}</NavigationProvider> : children;
}
