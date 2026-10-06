"use client";

/**
 * A3ui (UNI-927) - Insert > Shapes gallery.
 *
 * A Popover in the UniWork toolbar pattern: grouped preset cells, each drawing
 * the preset silhouette with the local preview geometry from `./insert-model`
 * (the vendored gallery module is not reachable from `packages/views`). The
 * component owns nothing but the open state; the chosen preset leaves through
 * `onInsert`, which the host binds to the registered `add_element` edit kind.
 */
import { useState } from "react";
import { Shapes } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { PPTX_INSERT_SHAPE_GROUPS, shapePreviewBox, shapePreviewPath, type PptxInsertShape } from "./insert-model";

/** Stroke-only gallery cell: the same silhouette the inserted preset draws. */
function ShapePreview({ prst, size = 18 }: { prst: string; size?: number }) {
  const { w, h } = shapePreviewBox(prst, size);
  const d = shapePreviewPath(prst, w, h);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`-1 ${-1 - (size - h) / 2} ${size + 2} ${size + 2}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

export interface PptxShapeGalleryProps {
  /** No slide bound, or the host has no edit channel. */
  disabled?: boolean;
  /** An insert is in flight; the gallery stays closed and inert. */
  busy?: boolean;
  onInsert: (shape: PptxInsertShape) => void;
  className?: string;
}

export function PptxShapeGallery({ disabled = false, busy = false, onInsert, className }: PptxShapeGalleryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const blocked = disabled || busy;
  const label = t("office.pptx.insert.shapes.open");
  return (
    <Popover open={open} onOpenChange={(next) => { if (!blocked) setOpen(next); }}>
      <PopoverTrigger
        disabled={blocked}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-label={label}
            aria-pressed={open}
            aria-disabled={blocked || undefined}
            data-pptx-insert-shapes-open
            className={cn(className)}
          >
            <Shapes aria-hidden="true" />
            <span className="text-label">{label}</span>
          </Button>
        }
      />
      <PopoverContent align="start" className="w-72">
        <p className="px-1 text-caption text-muted-foreground">{t("office.pptx.insert.shapes.description")}</p>
        <div className="max-h-80 space-y-3 overflow-y-auto" role="group" aria-label={t("office.pptx.insert.shapes.gallery_label")}>
          {PPTX_INSERT_SHAPE_GROUPS.map((group) => (
            <section key={group.id} data-pptx-shape-group={group.id}>
              <h3 className="px-1 pb-1 text-caption font-medium text-foreground">{t(group.labelKey)}</h3>
              <div className="grid grid-cols-6 gap-1">
                {group.shapes.map((shape) => {
                  const shapeLabel = t(shape.labelKey);
                  return (
                    <Button
                      key={shape.prst}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={shapeLabel}
                      title={shapeLabel}
                      data-pptx-shape-insert={shape.prst}
                      onClick={() => {
                        onInsert(shape);
                        setOpen(false);
                      }}
                    >
                      <ShapePreview prst={shape.prst} />
                    </Button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}