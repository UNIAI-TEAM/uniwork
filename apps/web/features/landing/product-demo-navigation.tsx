"use client";

import { useMemo, type ReactNode } from "react";
import { NavigationProvider } from "@uniwork/views/navigation";

/** Shared product links stay within their host's sample workspace. */
export function ProductDemoNavigation({ onOpen, children }: { onOpen: (path: string) => void; children: ReactNode }) {
  const value = useMemo(() => ({ push: onOpen, replace: onOpen, back: () => onOpen(""), pathname: "/demo", searchParams: new URLSearchParams(), getShareableUrl: (path: string) => `#demo${path}` }), [onOpen]);
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}
