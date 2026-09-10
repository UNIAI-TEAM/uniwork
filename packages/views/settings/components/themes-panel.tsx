"use client";

import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { useAccent } from "@uniwork/ui/hooks/use-accent";
import { ACCENT_NAMES, accentSwatchVars, type AccentName } from "@uniwork/ui/lib/accent";
import { cn } from "@uniwork/ui/lib/utils";

type ThemeValue = "light" | "dark" | "system";

const APPEARANCES: ThemeValue[] = ["light", "dark", "system"];

/* The mock is a PICTURE of a theme, not themed chrome: the light tile has to
   stay light while the app is dark, so it cannot read `var(--page-canvas)` and
   must carry both palettes at once. Every value is still a real token — page is
   --page-canvas, rail --sidebar, card --card, edge --border, line
   --faint-foreground — copied out of tokens.css and held to it by
   `themes-panel.tokens.test.ts`, because a copied colour drifts silently the
   day the palette moves. The accent squares are the exception: they read
   `--brand`, so the previews recolour live as the accent changes. */
export const MOCK = {
  light: { page: "#f8f9fa", rail: "#f1f1f9", card: "#ffffff", line: "#8a8a8a", edge: "#cfcfcf" },
  dark: { page: "#111111", rail: "#1e1e1e", card: "#181818", line: "#8b8b95", edge: "#2e2e2e" },
} as const;

/** The tokens.css slot each MOCK colour is copied from, per theme block. */
export const MOCK_TOKENS = {
  page: "--page-canvas",
  rail: "--sidebar",
  card: "--card",
  line: "--faint-foreground",
  edge: "--border",
} as const;

/** One miniature app window: rail on the left, a card with copy lines. */
function ThemeMock({ tone }: { tone: keyof typeof MOCK }) {
  const c = MOCK[tone];
  return (
    <div
      className="flex h-full w-full gap-1.5 p-2"
      style={{ background: c.page }}
      aria-hidden
    >
      <div
        className="flex w-1/4 shrink-0 flex-col gap-1.5 rounded-sm p-1.5"
        style={{ background: c.rail, border: `1px solid ${c.edge}` }}
      >
        <div className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--brand)" }} />
        <div className="h-1.5 w-full rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
      </div>
      <div
        className="flex flex-1 flex-col gap-1.5 rounded-sm p-1.5"
        style={{ background: c.card, border: `1px solid ${c.edge}` }}
      >
        <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
        <div className="mt-auto flex items-center gap-1">
          <div className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--brand)" }} />
          <div className="h-1.5 w-1/3 rounded-full" style={{ background: c.line }} />
          <div className="h-1.5 w-1/4 rounded-full" style={{ background: "var(--brand)" }} />
        </div>
      </div>
    </div>
  );
}

/**
 * `system` is drawn as the light mock with its right half overlaid by the dark
 * one, so the tile shows the split the setting actually produces. The inner
 * element is double width and right-anchored: that keeps the dark copy in the
 * SAME position as the light one underneath, so the two halves line up instead
 * of showing two squashed windows.
 */
function AppearanceMock({ value }: { value: ThemeValue }) {
  if (value !== "system") return <ThemeMock tone={value === "dark" ? "dark" : "light"} />;
  return (
    <div className="relative h-full w-full">
      <ThemeMock tone="light" />
      <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
        <div className="absolute inset-y-0 right-0 w-[200%]">
          <ThemeMock tone="dark" />
        </div>
      </div>
    </div>
  );
}

/**
 * The two theming axes in one place: appearance (light / dark / follow the OS,
 * owned by next-themes) and accent (the brand hue, owned by `lib/accent.ts`).
 *
 * Both grids are native radio inputs behind `sr-only` — arrow-key navigation,
 * grouping and the checked state come from the platform, and `has-checked:`
 * styles the card off the input rather than a hand-rolled `role="radio"`.
 */
export function ThemesPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.preferences" });
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();

  // next-themes returns undefined until mounted; `system` is the default.
  const current: ThemeValue =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  const appearanceLabel: Record<ThemeValue, string> = {
    light: t("themeLight"),
    dark: t("themeDark"),
    system: t("themeSystem"),
  };

  return (
    <div className="space-y-8">
      <fieldset className="space-y-3">
        <legend className="text-body font-semibold">{t("appearance")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {APPEARANCES.map((value) => (
            <label
              key={value}
              className={cn(
                "group cursor-pointer rounded-xl outline-none",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              )}
            >
              <input
                type="radio"
                name="uw-appearance"
                value={value}
                checked={current === value}
                onChange={() => setTheme(value)}
                className="sr-only"
              />
              <div
                className={cn(
                  "relative aspect-[16/10] overflow-hidden rounded-xl border-2 border-transparent",
                  // Selecting a tile moves BOTH the border and the ring; naming
                  // only the shadow left the border snapping while the ring faded.
                  "ring-1 ring-border transition-[border-color,box-shadow]",
                  "group-hover:ring-input",
                  "group-has-checked:border-brand group-has-checked:ring-brand",
                )}
              >
                <AppearanceMock value={value} />
                {/* The tile's selected state was carried by border and ring
                    colour alone. The badge repeats it as a shape, which is the
                    same cue the accent chips already use. */}
                <span
                  className={cn(
                    "absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full",
                    "bg-brand text-brand-foreground opacity-0 transition-opacity group-has-checked:opacity-100",
                  )}
                  aria-hidden
                >
                  <Check className="size-3.5" />
                </span>
              </div>
              <span className="mt-2 block text-body font-medium">{appearanceLabel[value]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-body font-semibold">{t("accent")}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ACCENT_NAMES.map((name) => (
            <label
              key={name}
              className={cn(
                "group flex cursor-pointer items-center gap-3 rounded-lg border border-border",
                "bg-surface px-3 py-2.5 transition-colors",
                "hover:border-input",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                "has-checked:border-brand has-checked:bg-surface-selected",
              )}
            >
              <input
                type="radio"
                name="uw-accent"
                value={name}
                checked={accent === name}
                onChange={() => setAccent(name as AccentName)}
                className="sr-only"
              />
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  "bg-[var(--sw)] dark:bg-[var(--sw-dark)]",
                )}
                style={accentSwatchVars(name) as CSSProperties}
                aria-hidden
              >
                <Check
                  className={cn(
                    "size-4 opacity-0 transition-opacity group-has-checked:opacity-100",
                    "text-[var(--sw-ink)] dark:text-[var(--sw-ink-dark)]",
                  )}
                />
              </span>
              <span className="truncate text-body font-medium group-has-checked:text-brand">
                {t(`accents.${name}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
