"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export interface PptxSlideView {
  id: string;
  label?: string;
  thumbnailUrl?: string;
  hidden?: boolean;
}

export interface PptxSlideRailProps {
  slides: readonly PptxSlideView[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Delete/Backspace on a focused thumbnail deletes that slide (UNI-958). The caller
   *  refuses a one-slide deck with its reason; absent leaves the key inert. */
  onDelete?: (index: number) => void;
  className?: string;
}

/** A keyboard-first slide navigator. It never edits the deck itself; selection
 * and Delete are passed back to the one editor session owned by the caller. */
export function PptxSlideRail({ slides, selectedIndex, onSelect, onDelete, className }: PptxSlideRailProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const buttonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  // r2 M2: the deleted thumbnail unmounts with its focus; once the deck is shorter,
  // focus the thumbnail now at the selected index so Delete and arrows keep working.
  const refocusBelow = useRef<number | null>(null);
  useEffect(() => {
    if (refocusBelow.current === null || slides.length >= refocusBelow.current) return;
    refocusBelow.current = null;
    buttonRefs.current[Math.min(selectedIndex, slides.length - 1)]?.focus();
  }, [selectedIndex, slides.length]);
  const moveSelection = (index: number) => {
    const bounded = Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0));
    onSelect(bounded);
    buttonRefs.current[bounded]?.focus();
  };
  return (
    <nav className={cn("flex w-28 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-office-canvas p-2 max-[480px]:w-16 max-[480px]:gap-1.5 max-[480px]:p-1 sm:w-36", className)} aria-label={t("slide_rail_label")} data-pptx-slide-rail>
      {slides.length === 0 ? <p className="px-1 text-caption text-muted-foreground">{t("no_slides")}</p> : null}
      {slides.map((slide, index) => {
        const selected = selectedIndex === index;
        return (
          <button
            key={slide.id}
            type="button"
            aria-label={t("slide_label", { index: index + 1, label: slide.label ?? "" })}
            aria-current={selected ? "page" : undefined}
            aria-disabled={slide.hidden ? "true" : undefined}
            aria-keyshortcuts={onDelete ? "Delete" : undefined}
            data-slide-index={index}
            data-selected={selected}
            tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
            ref={(element) => { buttonRefs.current[index] = element; }}
            className={cn(
              "group flex min-h-16 flex-col gap-1 rounded-md max-[480px]:min-h-0 pointer-coarse:max-[480px]:min-h-11 border border-border bg-muted/20 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-primary ring-1 ring-primary",
              slide.hidden && "opacity-60",
            )}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); moveSelection(index + 1); }
              if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); moveSelection(index - 1); }
              if (event.key === "Home") { event.preventDefault(); moveSelection(0); }
              if (event.key === "End") { event.preventDefault(); moveSelection(slides.length - 1); }
              if (event.key === "Delete" || event.key === "Backspace") {
                // The canvas Delete removes the selected shape; a slide's Delete stays here.
                event.preventDefault();
                event.stopPropagation();
                if (!onDelete) return;
                refocusBelow.current = slides.length;
                onDelete(index);
              }
            }}
          >
            <span className="relative flex aspect-video items-center justify-center overflow-hidden rounded-sm border border-border bg-background text-caption text-muted-foreground">
              {slide.thumbnailUrl ? <img src={slide.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : index + 1}
              {/* A rendered slide is white in both themes, so the button's opacity alone leaves a bright block in dark. */}
              {slide.hidden ? <span aria-hidden className="absolute inset-0 bg-background/70" data-slide-hidden-veil /> : null}
            </span>
            <span className="truncate px-1 text-caption font-medium max-[480px]:hidden">{slide.label ?? t("slide_number", { index: index + 1 })}</span>
          </button>
        );
      })}
    </nav>
  );
}
