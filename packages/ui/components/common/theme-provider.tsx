"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

export { useTheme };
import { THEME_BOOT } from "../../lib/theme-boot";
import { TooltipProvider } from "../ui/tooltip";

/** React 19 warns on `<script>` in client trees; SSR HTML still gets the real tag. */
const nextThemesScriptProps: React.ComponentProps<typeof NextThemesProvider>["scriptProps"] =
  typeof window !== "undefined" ? { type: "application/json" } : undefined;

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute={THEME_BOOT.attribute}
      defaultTheme={THEME_BOOT.defaultTheme}
      enableSystem={THEME_BOOT.enableSystem}
      storageKey={THEME_BOOT.storageKey}
      disableTransitionOnChange
      scriptProps={nextThemesScriptProps}
      {...props}
    >
      <TooltipProvider delay={500}>
        {children}
      </TooltipProvider>
    </NextThemesProvider>
  );
}
