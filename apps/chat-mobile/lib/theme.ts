// Ported from usf apps/mobile/lib/theme.ts. TypeScript mirror of the CSS
// variables in global.css (themselves tokens.css converted to HSL): THEME for
// inline styles and anywhere a Tailwind class cannot reach, NAV_THEME for the
// expo-router <ThemeProvider>. Change global.css and this file together.
import { DarkTheme, DefaultTheme, type Theme } from "expo-router";

export const THEME = {
  light: {
    background: "hsl(0 0% 100%)",
    foreground: "hsl(0 0% 12.5%)",
    card: "hsl(0 0% 100%)",
    cardForeground: "hsl(0 0% 12.5%)",
    popover: "hsl(0 0% 100%)",
    popoverForeground: "hsl(0 0% 12.5%)",
    primary: "hsl(220.4 91.7% 47.1%)",
    primaryForeground: "hsl(0 0% 100%)",
    secondary: "hsl(240 4.8% 95.9%)",
    secondaryForeground: "hsl(0 0% 12.5%)",
    muted: "hsl(240 4.8% 95.9%)",
    mutedForeground: "hsl(0 0% 39.2%)",
    accent: "hsl(240 4.8% 95.9%)",
    accentForeground: "hsl(0 0% 12.5%)",
    destructive: "hsl(0 73.9% 39%)",
    destructiveForeground: "hsl(0 0% 100%)",
    border: "hsl(240 5.9% 90%)",
    input: "hsl(240 3.4% 54.5%)",
    ring: "hsl(220.4 91.7% 47.1%)",
    brand: "hsl(220.4 91.7% 47.1%)",
    brandForeground: "hsl(0 0% 100%)",
  },
  dark: {
    background: "hsl(0 0% 6.7%)",
    foreground: "hsl(210 16.7% 97.6%)",
    card: "hsl(0 0% 9.4%)",
    cardForeground: "hsl(210 16.7% 97.6%)",
    popover: "hsl(0 0% 9.4%)",
    popoverForeground: "hsl(210 16.7% 97.6%)",
    primary: "hsl(218.2 100% 67.6%)",
    primaryForeground: "hsl(224.2 42.2% 8.8%)",
    secondary: "hsl(0 0% 14.9%)",
    secondaryForeground: "hsl(210 16.7% 97.6%)",
    muted: "hsl(0 0% 14.9%)",
    mutedForeground: "hsl(240 5% 64.9%)",
    accent: "hsl(0 0% 14.9%)",
    accentForeground: "hsl(210 16.7% 97.6%)",
    destructive: "hsl(0 90.6% 70.8%)",
    destructiveForeground: "hsl(224.2 42.2% 8.8%)",
    border: "hsl(0 0% 18%)",
    input: "hsl(240 3.4% 45.5%)",
    ring: "hsl(218.2 100% 67.6%)",
    brand: "hsl(218.2 100% 67.6%)",
    brandForeground: "hsl(224.2 42.2% 8.8%)",
  },
};

export const NAV_THEME: Record<"light" | "dark", Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
