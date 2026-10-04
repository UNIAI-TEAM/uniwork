"use client";

/**
 * Slide layout picker (Design tab, `set_slide_layout`). One option per layout the
 * host's catalog reports (`listSlideLayouts`), plus a reset to the master layout
 * for the "neither layout nor layoutPath" case the vendored op treats as a reset.
 *
 * A layout is applied to ONE slide, so the option is disabled when there is no
 * selected slide - the panel never guesses a target. Keyboard: roving group with
 * wrap-around arrows and Home/End, matching the other pickers on this tab.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { nextRovingIndex, rovingEntryIndex, type PptxDesignLayout } from "./design-model";

export interface PptxLayoutPickerProps {
  layouts: readonly PptxDesignLayout[];
  /** Part path of the slide's current layout, when the host can report one. */
  activeLayoutPath?: string | null;
  /** 0-based target slide; null disables the picker (no target). */
  slideIndex?: number | null;
  busy?: boolean;
  disabled?: boolean;
  onApplyLayout: (layoutPath: string) => void;
  onResetLayout: () => void;
  className?: string;
}

export function PptxLayoutPicker({
  layouts,
  activeLayoutPath = null,
  slideIndex = null,
  busy = false,
  disabled = false,
  onApplyLayout,
  onResetLayout,
  className,
}: PptxLayoutPickerProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const activeIndex = layouts.findIndex((layout) => layout.path === activeLayoutPath);
  const [focusIndex, setFocusIndex] = useState(() => rovingEntryIndex(activeIndex, layouts.length));
  // The catalog and the active path can arrive after mount (the host read is
  // async), so re-seed the roving stop until the user has moved focus. The
  // clamp keeps a tabbable option when the catalog shrinks.
  const focusTouched = useRef(false);
  useEffect(() => {
    if (!focusTouched.current) setFocusIndex(rovingEntryIndex(activeIndex, layouts.length));
  }, [activeIndex, layouts.length]);
  const blocked = disabled || busy || slideIndex === null;

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex(index, layouts.length, event.key);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[data-layout-option]")[next]?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-caption font-medium text-muted-foreground">{t("design.layout_label")}</span>
      {layouts.length === 0 ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-design-layout-empty">
          {t("design.layout_empty")}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label={t("design.layout_group_label")}
          aria-busy={busy || undefined}
          data-pptx-layout-picker
          className="flex flex-wrap gap-2"
        >
          {layouts.map((layout, index) => {
            const active = layout.path === activeLayoutPath;
            return (
              <button
                key={layout.path}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={t("design.layout_apply", { name: layout.name })}
                disabled={blocked}
                tabIndex={index === focusIndex ? 0 : -1}
                data-layout-option={layout.path}
                data-active={active}
                onFocus={() => {
                  focusTouched.current = true;
                  setFocusIndex(index);
                }}
                onKeyDown={(event) => move(event, index)}
                onClick={() => !blocked && onApplyLayout(layout.path)}
                className={cn(
                  "flex min-w-24 items-center rounded-md border border-border bg-background px-2 py-1 text-left text-caption",
                  active && "border-primary ring-1 ring-primary",
                  blocked && "opacity-60",
                )}
              >
                <span className="truncate">{layout.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        disabled={blocked}
        data-pptx-layout-reset
        onClick={() => !blocked && onResetLayout()}
        className={cn(
          "w-fit rounded-md border border-border bg-background px-2 py-1 text-caption text-muted-foreground",
          blocked && "opacity-60",
        )}
      >
        {t("design.layout_reset")}
      </button>
    </div>
  );
}