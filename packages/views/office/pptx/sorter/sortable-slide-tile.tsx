"use client";

/**
 * A2 UI half (UNI-927) - one draggable slide tile in the sorter grid.
 *
 * Presentational + props-driven: the panel owns the deck order and the edit
 * channel, this tile only reports "select me" and "move me to index N". The drag
 * handle is a real button so the reorder is reachable from the keyboard
 * (Left/Up = one position earlier, Right/Down = one position later) without
 * depending on dnd-kit's sensors, and it carries the dnd-kit listeners for the
 * pointer path.
 */
import { useTranslation } from "react-i18next";
import { GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@uniwork/ui/lib/utils";
import { clampSlideIndex, keyboardReorderTarget, type PptxSorterSlide } from "./sorter-helpers";

export interface PptxSortableSlideTileProps {
  slide: PptxSorterSlide;
  index: number;
  slideCount: number;
  selected: boolean;
  /** Drag reorder is off for an empty, read-only, or in-flight deck. */
  reorderDisabled?: boolean;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
}

export function PptxSortableSlideTile({
  slide,
  index,
  slideCount,
  selected,
  reorderDisabled = false,
  onSelect,
  onReorder,
}: PptxSortableSlideTileProps) {
  const { t } = useTranslation();
  const sortable = useSortable({ id: slide.id, disabled: reorderDisabled });
  const handleKeyDown = (key: string) => {
    const target = keyboardReorderTarget(index, slideCount, key, 1);
    if (target === null) return;
    onReorder(index, target);
  };
  return (
    <li
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={cn("relative flex min-w-0 flex-col gap-1", sortable.isDragging && "opacity-60")}
      data-pptx-sorter-slide={index}
      data-slide-index={index}
      data-selected={selected}
      data-dragging={sortable.isDragging ? "true" : undefined}
    >
      <button
        type="button"
        aria-label={t("office.pptx.sorter.slide_label", {
          index: index + 1,
          label: slide.label ? `: ${slide.label}` : "",
        })}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border bg-background text-caption text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-primary ring-2 ring-primary" : "border-border",
        )}
        onClick={() => onSelect(clampSlideIndex(index, slideCount))}
      >
        {slide.thumbnailUrl ? (
          <img src={slide.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span data-pptx-sorter-placeholder>{index + 1}</span>
        )}
      </button>
      <div className="flex min-w-0 items-center justify-between gap-1 px-0.5">
        <span className="min-w-0 truncate text-caption font-medium">
          {t("office.pptx.sorter.slide_label", {
            index: index + 1,
            label: slide.label ? `: ${slide.label}` : "",
          })}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {slide.hidden ? (
            <span className="rounded-sm bg-muted px-1 text-micro text-muted-foreground" data-pptx-sorter-hidden>
              {t("office.pptx.sorter.slide_hidden")}
            </span>
          ) : null}
          <button
            type="button"
            aria-label={t("office.pptx.sorter.drag_handle", { index: index + 1 })}
            disabled={reorderDisabled}
            className={cn(
              "inline-flex size-6 cursor-grab items-center justify-center rounded-sm text-muted-foreground",
              "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
            data-pptx-sorter-handle={index}
            ref={sortable.setActivatorNodeRef}
            {...sortable.attributes}
            {...sortable.listeners}
            onKeyDown={(event) => {
              if (event.key === " " || event.key === "Enter") event.preventDefault();
              handleKeyDown(event.key);
            }}
          >
            <GripVertical aria-hidden className="size-3.5" />
          </button>
        </span>
      </div>
    </li>
  );
}