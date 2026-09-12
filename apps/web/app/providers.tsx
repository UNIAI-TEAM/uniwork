"use client";
// Must be first: it feeds packages/core the endpoint origins before any
// module below can issue a request with them.
import "../platform/runtime-config";
// Registers the Web Push adapter when the browser supports it; no exports.
import "../platform/push";
import type { SupportedLocale } from "@uniwork/core/i18n";
import { CoreProvider } from "@uniwork/core/platform";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { Toaster } from "@uniwork/ui/components/ui/sonner";
import { WebFeatureFlagsProvider } from "../platform/feature-flags";
import { WebLocaleProvider } from "../platform/locale";
import { WebNavigationProvider } from "../platform/navigation";

/**
 * Host composition for the web app: the request's locale first (see the note
 * on the ordering below), then the shared headless boot (query cache, session)
 * from CoreProvider, the flag source (GET /config, which also starts
 * web-vitals reporting), then the two things only this host provides — a
 * router adapter and a toast outlet.
 */
export function Providers({
  initialLocale,
  initialMessages,
  children,
}: {
  initialLocale: SupportedLocale;
  initialMessages: Record<string, unknown> | null;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider>
      {/* Above CoreProvider, not below it. CoreProvider boots a default i18next
          for hosts that have no locale of their own, and i18next initialises
          once: whichever provider renders first decides the language. The
          locale lives in this request's cookie, so this host has to get there
          first or every page renders the default. */}
      <WebLocaleProvider initialLocale={initialLocale} initialMessages={initialMessages}>
        <CoreProvider>
          <WebFeatureFlagsProvider>
            <WebNavigationProvider>{children}</WebNavigationProvider>
          </WebFeatureFlagsProvider>
          <Toaster />
        </CoreProvider>
      </WebLocaleProvider>
    </ThemeProvider>
  );
}
