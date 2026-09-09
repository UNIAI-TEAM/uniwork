"use client";

import { runtimeConfig } from "@uniwork/core/runtime-config";

/**
 * App origin for distinguishing internal vs external links in the editor.
 * Comes from platform `configureRuntime({ appUrl })`, not `window.location`.
 */
export function useAppOrigin(): string | null {
  const url = runtimeConfig().appUrl;
  return url || null;
}
