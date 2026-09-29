"use client";

import { useRef } from "react";
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
  className?: string;
}

/** A keyboard-first slide navigator. It never edits the deck; selection is
 * passed back to the one editor session owned by the caller. */
export function PptxSlideRail({ slides, selectedIndex, onSelect, className }: PptxSlideRailProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const buttonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const moveSelection = (index: number) => {
    const bounded = Math.min(Math.max(index, 0), Math.max(slides.length - 1, 0));
    onSelect(bounded);
    buttonRefs.current[bounded]?.focus();
  };
  return (
    <nav className={cn("flex w-28 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-2 sm:w-36", className)} aria-label={t("slide_rail_label")} data-pptx-slide-rail>
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
            data-slide-index={index}
            data-selected={selected}
            tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
            ref={(element) => { buttonRefs.current[index] = element; }}
            className={cn(
              "group flex min-h-16 flex-col gap-1 rounded-md border border-border bg-muted/20 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected && "border-primary ring-1 ring-primary",
              slide.hidden && "opacity-60",
            )}
            onClick={() => onSelect(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); moveSelection(index + 1); }
              if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); moveSelection(index - 1); }
              if (event.key === "Home") { event.preventDefault(); moveSelection(0); }
              if (event.key === "End") { event.preventDefault(); moveSelection(slides.length - 1); }
            }}
          >
            <span className="flex aspect-video items-center justify-center overflow-hidden rounded-sm border border-border bg-background text-caption text-muted-foreground">
              {slide.thumbnailUrl ? <img src={slide.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : index + 1}
            </span>
            <span className="truncate px-1 text-caption font-medium">{slide.label ?? t("slide_number", { index: index + 1 })}</span>
          </button>
        );
      })}
    </nav>
  );
}
