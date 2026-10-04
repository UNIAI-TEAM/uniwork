"use client";

// B9 (UNI-924): Insert ▸ Shapes gallery. Clicking a cell inserts the basic
// shape at the current top-level position; the shape's own text is edited
// in-canvas (double-click) by the vendored docProtected node view.
import { useState } from "react";
import { Shapes } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import type { DocxShapeKind } from "@uniwork/office-engine/docx";
import { DOCX_SHAPE_GALLERY } from "./docx-shape-model";

/** Open-V arrowhead at (x2,y2), pointing away from (x1,y1) — ported from the
 * vendored gallery preview (shape-svg.ts:41). */
function arrowHeadPath(x1: number, y1: number, x2: number, y2: number, len: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const bx = x2 - ux * len;
  const by = y2 - uy * len;
  const wl = len * 0.6;
  return `M ${bx - uy * wl} ${by + ux * wl} L ${x2} ${y2} L ${bx + uy * wl} ${by - ux * wl}`;
}

/** 24×18 stroke-only previews per basic shape (genoffice gallery parity). */
const PREVIEW_PATHS: Record<DocxShapeKind, string> = {
  rect: "M 3 3 H 21 V 15 H 3 Z",
  ellipse: "M 3 9 A 9 6 0 1 1 21 9 A 9 6 0 1 1 3 9 Z",
  line: "M 3 14 L 21 4",
  arrow: `M 3 14 L 21 4 ${arrowHeadPath(3, 14, 21, 4, 6)}`,
  textBox: "M 3 3 H 21 V 15 H 3 Z M 6 7 H 18 M 6 11 H 13",
};

function ShapePreview({ kind }: { kind: DocxShapeKind }) {
  return (
    <svg
      viewBox="0 0 24 18"
      className="h-4 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PREVIEW_PATHS[kind]} />
    </svg>
  );
}

export function DocxShapeGallery({
  disabled,
  onInsert,
}: {
  disabled: boolean;
  onInsert: (kind: DocxShapeKind, label: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-label={t("office.docx.shapes.insert")}
            aria-pressed={open}
            data-testid="docx-shape-gallery-open"
          >
            <Shapes aria-hidden />
            <span className="text-label">{t("office.docx.shapes.insert")}</span>
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64">
        <div role="group" aria-label={t("office.docx.shapes.galleryLabel")} className="grid grid-cols-3 gap-1">
          {DOCX_SHAPE_GALLERY.map((item) => (
            <Button
              key={item.kind}
              type="button"
              variant="ghost"
              size="sm"
              className="h-14 flex-col gap-1"
              aria-label={t(item.labelKey)}
              title={t(item.labelKey)}
              data-testid={`docx-shape-insert-${item.kind}`}
              onClick={() => {
                onInsert(item.kind, t(item.labelKey));
                setOpen(false);
              }}
            >
              <ShapePreview kind={item.kind} />
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
