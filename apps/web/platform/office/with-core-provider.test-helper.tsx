import { createElement, type ReactNode } from "react";
import { CoreProvider } from "@uniwork/core/platform";

/** Mounts the shared query client the hosts read GET /api/v1/config through. */
export function withCoreProvider(children: ReactNode) {
  return createElement(CoreProvider, { initializeAuth: false }, children);
}
