"use client";
// Must be first: it feeds packages/core the endpoint origins before any
// module below can issue a request with them.
import "../platform/runtime-config";
import type { SupportedLocale } from "@uniwork/core/i18n";
import { CoreProvider } from "@uniwork/core/platform";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { Toaster } from "@uniwork/ui/components/ui/sonner";
import { WebLocaleProvider } from "../platform/locale";
import { WebNavigationProvider } from "../platform/navigation";

/**
 * Host composition for the web app: the shared headless boot (query cache,
 * session, i18n) from CoreProvider, then the two things only this host
 * provides — a router adapter and a toast outlet.
 */
export function Providers({ initialLocale, children }: { initialLocale: SupportedLocale; children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CoreProvider>
        <WebLocaleProvider initialLocale={initialLocale}>
          <WebNavigationProvider>{children}</WebNavigationProvider>
        </WebLocaleProvider>
        <Toaster />
      </CoreProvider>
    </ThemeProvider>
  );
}
