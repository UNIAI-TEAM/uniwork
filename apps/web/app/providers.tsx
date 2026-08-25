"use client";
// Must be first: it feeds packages/core the endpoint origins before any
// module below can issue a request with them.
import "../platform/runtime-config";
import { CoreProvider } from "@uniwork/core/platform";
import { Toaster } from "@uniwork/ui/components/ui/sonner";
import { WebNavigationProvider } from "../platform/navigation";

/**
 * Host composition for the web app: the shared headless boot (query cache,
 * session, i18n) from CoreProvider, then the two things only this host
 * provides — a router adapter and a toast outlet.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CoreProvider>
      <WebNavigationProvider>{children}</WebNavigationProvider>
      <Toaster />
    </CoreProvider>
  );
}
