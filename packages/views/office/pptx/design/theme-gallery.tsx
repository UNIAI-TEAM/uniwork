"use client";

/**
 * Theme gallery (Design tab, `apply_theme`). One card per built-in preset; the
 * card paints the preset's own page background, body colour and four accents so
 * the choice is visible before it is applied, and reports the preset id upward.
 *
 * The panel owns the edit; this component only renders options and reports the
 * picked one, so it can be unit-tested without an engine, a host or a session.
 *
 * Keyboard: the cards form a single roving-focus group (radiogroup semantics) -
 * arrows move with wrap-around, Home/End jump to the ends, and Tab enters the
 * gallery once instead of walking every card.
 */
import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import {
  PPTX_DESIGN_THEMES,
  nextRovingIndex,
  rovingEntryIndex,
  themeSwatch,
  type PptxDesignTheme,
} from "./design-model";

/** Glyph on a theme card. A plain TS literal, never a JSX text node, so the
 * package's i18next/no-literal-string rule stays honest. */
const THEME_GLYPH = "Aa";

export interface PptxThemeGalleryProps {
  /** Id of the deck's current theme, when the host can report one. */
  activeThemeId?: string | null;
  /** Applying is in flight; every card is disabled until it settles. */
  busy?: boolean;
  disabled?: boolean;
  onApplyTheme: (themeId: string) => void;
  className?: string;
}

export function PptxThemeGallery({
  activeThemeId = null,
  busy = false,
  disabled = false,
  onApplyTheme,
  className,
}: PptxThemeGalleryProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  // The model stores each theme's FULL i18n key (`office.pptx.design.theme.*`),
  // so its lookup must run against the root, not the panel prefix - a prefixed
  // call would double the namespace and leave the key untranslated.
  const { t: tRoot } = useTranslation();
  const activeIndex = PPTX_DESIGN_THEMES.findIndex((theme) => theme.id === activeThemeId);
  const [focusIndex, setFocusIndex] = useState(() => rovingEntryIndex(activeIndex, PPTX_DESIGN_THEMES.length));
  const blocked = disabled || busy;

  // The key event arrives on a card; the roving target is the next card in the
  // same radiogroup, so the query starts at the card's own parent.
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(index, PPTX_DESIGN_THEMES.length, event.key);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-theme-card]")[next]?.focus();
  };

  const renderCard = (theme: PptxDesignTheme, index: number) => {
    const swatch = themeSwatch(theme);
    const active = theme.id === activeThemeId;
    const name = tRoot(theme.nameKey);
    return (
      <button
        key={theme.id}
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={active ? t("design.theme_active", { name }) : t("design.theme_apply", { name })}
        disabled={blocked}
        tabIndex={index === focusIndex ? 0 : -1}
        data-theme-card={theme.id}
        data-active={active}
        onFocus={() => setFocusIndex(index)}
        onKeyDown={(event) => move(event, index)}
        onClick={() => !blocked && onApplyTheme(theme.id)}
        className={cn(
          "flex w-24 flex-col items-stretch gap-1 rounded-md border border-border bg-background p-1 text-left",
          active && "border-primary ring-1 ring-primary",
          blocked && "opacity-60",
        )}
      >
        <span
          aria-hidden="true"
          data-theme-preview
          className="flex h-12 flex-col justify-between rounded-sm border border-border p-1.5"
          style={{ backgroundColor: swatch.background, color: swatch.foreground }}
        >
          <span className="font-heading text-label leading-none">{THEME_GLYPH}</span>
          <span className="flex gap-0.5">
            {swatch.accents.map((color) => (
              <span key={color} className="size-2 rounded-full" style={{ backgroundColor: color }} />
            ))}
          </span>
        </span>
        <span className="truncate px-0.5 text-caption text-muted-foreground">{name}</span>
      </button>
    );
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-caption font-medium text-muted-foreground">{t("design.themes_label")}</span>
      <div
        role="radiogroup"
        aria-label={t("design.theme_group_label")}
        aria-busy={busy || undefined}
        data-pptx-theme-gallery
        className="flex flex-wrap gap-2"
      >
        {PPTX_DESIGN_THEMES.map(renderCard)}
      </div>
    </div>
  );
}