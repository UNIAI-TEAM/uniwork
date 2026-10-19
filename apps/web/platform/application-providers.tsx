"use client";
import "./runtime-config";
import "./desktop-host";
import "./push";
import type { SupportedLocale } from "@uniwork/core/i18n/types";
import { CoreProvider } from "@uniwork/core/platform";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { Toaster } from "@uniwork/ui/components/ui/sonner";
import { WebFeatureFlagsProvider } from "./feature-flags";
import { DesktopHost } from "./desktop-host";
import { WebLocaleProvider } from "./locale";
import { WebNavigationProvider } from "./navigation";

export function ApplicationProviders({ initialLocale, initialDictionary, children }: { initialLocale: SupportedLocale; initialDictionary?: object; children: React.ReactNode }) {
  return <ThemeProvider><CoreProvider><WebFeatureFlagsProvider><WebLocaleProvider initialLocale={initialLocale} initialDictionary={initialDictionary}><WebNavigationProvider><DesktopHost />{children}</WebNavigationProvider></WebLocaleProvider></WebFeatureFlagsProvider><Toaster /></CoreProvider></ThemeProvider>;
}
