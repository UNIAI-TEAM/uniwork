"use client";

import { createContext, use, useMemo, useTransition } from "react";
import type { NavigationAdapter } from "./types";

const NavigationContext = createContext<NavigationAdapter | null>(null);
const NavigationPendingContext = createContext<boolean>(false);

export function NavigationProvider({
  value,
  children,
}: {
  value: NavigationAdapter;
  children: React.ReactNode;
}) {
  // push/replace are wrapped in startTransition so every caller of
  // useNavigation() — sidebar links, post-create jumps — gets a React pending
  // signal while the route commits. On web that stays true until Next has the
  // new RSC payload.
  const [isPending, startTransition] = useTransition();
  const wrapped = useMemo<NavigationAdapter>(
    () => ({
      ...value,
      push: (path: string) => startTransition(() => value.push(path)),
      replace: (path: string) => startTransition(() => value.replace(path)),
    }),
    [value],
  );
  return (
    <NavigationContext.Provider value={wrapped}>
      <NavigationPendingContext.Provider value={isPending}>{children}</NavigationPendingContext.Provider>
    </NavigationContext.Provider>
  );
}

/**
 * Non-throwing read, for leaf components that legitimately render outside a
 * provider (isolated mounts, their tests) and have a sane fallback. Anything
 * that must navigate uses useNavigation() and keeps the throw.
 */
export function useOptionalNavigation(): NavigationAdapter | null {
  return use(NavigationContext);
}

export function useNavigation(): NavigationAdapter {
  const ctx = use(NavigationContext);
  if (!ctx) throw new Error("useNavigation must be used within NavigationProvider");
  return ctx;
}

/** True while a transition-wrapped push/replace is committing. */
export function useIsNavigating(): boolean {
  return use(NavigationPendingContext);
}
