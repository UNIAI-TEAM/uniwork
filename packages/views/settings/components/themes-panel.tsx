"use client";

import { useId, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@uniwork/ui/components/common/theme-provider";
import { useAccent } from "@uniwork/ui/hooks/use-accent";
import { ACCENT_NAMES, accentSwatchVars, type AccentName } from "@uniwork/ui/lib/accent";
import { cn } from "@uniwork/ui/lib/utils";
import { SettingsSection } from "./settings-layout";

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
  light: { page: "#ffffff", rail: "#ffffff", card: "#ffffff", line: "#8a8a8a", edge: "#cfcfcf" },
  dark: { page: "#111111", rail: "#111111", card: "#181818", line: "#8b8b95", edge: "#2e2e2e" },
} as const;

/** The tokens.css slot each MOCK colour is copied from, per theme block. */
export const MOCK_TOKENS = {
  page: "--page-canvas",
  rail: "--sidebar",
  card: "--card",
  line: "--faint-foreground",
  edge: "--border",
} as const;

/**
 * The radio is `sr-only`, so its own focus ring cannot be seen; the tile
 * draws the same outline the global `:focus-visible` rule gives every other
 * control (2px `--ring`, offset 2px) while the radio inside has focus.
 */
const FOCUS_FROM_RADIO =
  "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring";

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
 * The two theming axes, one section each: appearance (light / dark / follow
 * the OS, owned by next-themes) and accent (the brand hue, owned by
 * `lib/accent.ts`). The section heading names the radio group, so there is one
 * heading per group instead of a section title over a legend.
 *
 * Both groups are native radio inputs behind `sr-only` — arrow-key navigation,
 * grouping and the checked state come from the platform, and `has-checked:`
 * styles the tile off the input rather than a hand-rolled `role="radio"`.
 */
export function ThemesPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.preferences" });
  const { theme, setTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const appearanceId = useId();
  const accentId = useId();

  // next-themes returns undefined until mounted; `system` is the default.
  const current: ThemeValue =
    theme === "light" || theme === "dark" || theme === "system" ? theme : "system";

  const appearanceLabel: Record<ThemeValue, string> = {
    light: t("themeLight"),
    dark: t("themeDark"),
    system: t("themeSystem"),
  };

  return (
    <>
      <SettingsSection
        title={<span id={appearanceId}>{t("appearance")}</span>}
        description={t("appearanceHint")}
      >
        <fieldset aria-labelledby={appearanceId} className="grid grid-cols-3 gap-3 sm:max-w-xl">
          {APPEARANCES.map((value) => (
            <label
              key={value}
              className={cn(
                "group min-w-0 cursor-pointer rounded-xl",
                FOCUS_FROM_RADIO,
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
              <span className="mt-2 block truncate text-body font-medium">{appearanceLabel[value]}</span>
            </label>
          ))}
        </fieldset>
      </SettingsSection>

      <SettingsSection title={<span id={accentId}>{t("accent")}</span>} description={t("accentHint")}>
        {/* Chips size to their names and wrap, so no count of accents leaves
            one stranded on a row of its own the way a fixed grid did. */}
        <fieldset aria-labelledby={accentId} className="flex flex-wrap gap-2">
          {ACCENT_NAMES.map((name) => (
            <label
              key={name}
              className={cn(
                "group flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-border",
                "bg-surface py-1 pr-3.5 pl-1.5 transition-colors pointer-coarse:min-h-11",
                "hover:border-input",
                FOCUS_FROM_RADIO,
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
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  "bg-[var(--sw)] dark:bg-[var(--sw-dark)]",
                )}
                style={accentSwatchVars(name) as CSSProperties}
                aria-hidden
              >
                <Check
                  className={cn(
                    "size-3.5 opacity-0 transition-opacity group-has-checked:opacity-100",
                    "text-[var(--sw-ink)] dark:text-[var(--sw-ink-dark)]",
                  )}
                />
              </span>
              <span className="text-body font-medium whitespace-nowrap group-has-checked:text-brand">
                {t(`accents.${name}`)}
              </span>
            </label>
          ))}
        </fieldset>
      </SettingsSection>
    </>
  );
}
