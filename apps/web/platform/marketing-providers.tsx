"use client";
import { QueryProvider } from "@uniwork/core/provider";
import { ThemeProvider } from "@uniwork/ui/components/common/theme-provider";
import { Toaster } from "@uniwork/ui/components/ui/sonner";
import { WebFeatureFlagsProvider } from "./feature-flags";

/** Public pages do not register Office drafts, session sync or push adapters. */
export function MarketingProviders({ children }: { children: React.ReactNode }) {
  return <ThemeProvider><QueryProvider><WebFeatureFlagsProvider>{children}</WebFeatureFlagsProvider><Toaster /></QueryProvider></ThemeProvider>;
}
