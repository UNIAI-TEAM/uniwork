// The navigation colours are the app's own tokens, per scheme, over the
// router's base theme (fonts and the rest stay expo-router's).
import { DarkTheme, DefaultTheme } from "expo-router";
import { THEME } from "@/lib/theme";
import { NAV_THEME } from "./nav-theme";

it("draws headers, the tab bar and the screen background from the tokens of each scheme", () => {
  for (const [scheme, base] of [
    ["light", DefaultTheme],
    ["dark", DarkTheme],
  ] as const) {
    const tokens = THEME[scheme];
    expect(NAV_THEME[scheme]).toEqual({
      ...base,
      colors: {
        background: tokens.background,
        border: tokens.border,
        card: tokens.card,
        notification: tokens.destructive,
        primary: tokens.primary,
        text: tokens.foreground,
      },
    });
    expect(NAV_THEME[scheme].dark).toBe(scheme === "dark");
  }
});
