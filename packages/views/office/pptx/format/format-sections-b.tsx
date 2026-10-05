"use client";

/**
 * Format panel sections, part 2 (A4ui, UNI-927): Size/Geometry, Arrange and Text.
 *
 * Same contract as part 1: each section owns its field state, validates locally
 * (so a bad field never reaches the deck) and reports exactly one committed
 * `FormatEdit` through `onApply`.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import {
  PPTX_ALIGN_MODES,
  PPTX_TEXT_ANCHORS,
  PPTX_TEXT_AUTOFIT,
  type FormatEdit,
  type PptxAlignMode,
  type PptxAlignTo,
  type PptxTextAnchor,
  type PptxTextAutofit,
} from "@uniwork/office-engine/pptx";
import {
  arrangeEnabled,
  buildAlignEdit,
  buildAutofitEdit,
  buildDistributeEdit,
  buildFlipEdit,
  buildGroupEdit,
  buildShapeGeometryEdit,
  buildTextAnchorEdit,
  buildUngroupEdit,
  buildWrapEdit,
  formatAlignKey,
} from "./format-model";
import { PPTX_INSERT_SHAPE_GROUPS } from "../insert/insert-model";

export interface PptxFormatArrangeSectionProps {
  slide: number;
  /** Anchor element id of the selection (ungroup target). */
  elementId: string;
  /** Every selected id, in selection order. */
  ids: readonly string[];
  /** Type of the anchor element, so Ungroup can be gated on a group. */
  elementType?: string | null;
  /** No port / read-only / busy / no selection. */
  blocked: boolean;
  onApply: (build: () => FormatEdit) => void;
}

export interface PptxFormatTextSectionProps {
  slide: number;
  elementId: string;
  blocked: boolean;
  allowed: boolean;
  onApply: (build: () => FormatEdit) => void;
  /** Current text anchor of the selection, for the radio group. */
  textAnchor?: PptxTextAnchor | null;
  /** Current autofit mode. */
  autofit?: PptxTextAutofit | null;
  /** Current wrap setting. */
  wrapText?: boolean | null;
}

/** Every preset the Insert gallery offers, flattened once: the format pane changes a shape to one of these. */
const GEOMETRY_PRESETS = PPTX_INSERT_SHAPE_GROUPS.flatMap((group) => group.shapes);

/**
 * "Change shape": a named list instead of the raw OOXML preset field the pane used
 * to expose. The shape's adjust-handle map (`set_shape_adjust`) has no user-facing
 * spelling, so it is not offered here.
 */
export function PptxFormatGeometrySection({
  slide,
  elementId,
  blocked,
  onApply,
}: Omit<PptxFormatArrangeSectionProps, "ids" | "elementType">) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const { t: tRoot } = useTranslation();
  const items = useMemo(
    () => GEOMETRY_PRESETS.map((shape) => ({ value: shape.prst, label: tRoot(shape.labelKey) })),
    [tRoot],
  );

  return (
    <section aria-label={t("format.geometry_label")} data-pptx-format-section="geometry" className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{t("format.geometry_label")}</span>
      <Select
        value={null}
        items={items}
        onValueChange={(value) => {
          if (value) onApply(() => buildShapeGeometryEdit(slide, elementId, value));
        }}
      >
        <SelectTrigger aria-label={t("format.geometry_prst")} data-testid="pptx-format-prst" size="sm" disabled={blocked} className="w-44">
          <SelectValue placeholder={t("format.geometry_placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

export function PptxFormatArrangeSection({
  slide,
  elementId,
  ids,
  elementType = null,
  blocked,
  onApply,
}: PptxFormatArrangeSectionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  // The align button labels are FULL office.pptx.format.* keys (formatAlignKey),
  // so they must be resolved on the root t(): a prefixed call would render
  // "office.pptx.office.pptx.format.*" verbatim.
  const { t: tRoot } = useTranslation();
  const [alignTo, setAlignTo] = useState<PptxAlignTo>("selection");
  const count = ids.length;
  const canGroup = arrangeEnabled("group", count);
  const canUngroup = arrangeEnabled("ungroup", count, elementType);
  const canFlip = arrangeEnabled("flip", count);
  const min = alignTo === "slide" ? 1 : 0;
  const canAlign = arrangeEnabled("align", count) || (min === 1 && count >= 1);
  const canDistribute = arrangeEnabled("distribute", count) || (min === 1 && count >= 1);

  return (
    <section aria-label={t("format.arrange_label")} data-pptx-format-section="arrange" className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{t("format.arrange_label")}</span>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !canGroup}
          data-testid="pptx-format-group"
          onClick={() => onApply(() => buildGroupEdit(slide, ids))}
        >
          {t("format.group")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !canUngroup}
          data-testid="pptx-format-ungroup"
          onClick={() => onApply(() => buildUngroupEdit(slide, elementId))}
        >
          {t("format.ungroup")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !canFlip}
          data-testid="pptx-format-flip-h"
          onClick={() => onApply(() => buildFlipEdit(slide, ids, "h"))}
        >
          {t("format.flip_h")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !canFlip}
          data-testid="pptx-format-flip-v"
          onClick={() => onApply(() => buildFlipEdit(slide, ids, "v"))}
        >
          {t("format.flip_v")}
        </Button>
      </div>
      <div role="radiogroup" aria-label={t("format.align_to_label")} className="flex flex-wrap gap-2">
        {(["selection", "slide"] as const).map((to) => (
          <button
            key={to}
            type="button"
            role="radio"
            aria-checked={alignTo === to}
            aria-label={t("format.align_to_" + to)}
            data-pptx-align-to={to}
            disabled={blocked}
            onClick={() => setAlignTo(to)}
            className={cn(
              "rounded-md border border-border bg-background px-2 py-1 text-caption",
              alignTo === to && "border-primary ring-1 ring-primary",
              blocked && "opacity-60",
            )}
          >
            {t("format.align_to_" + to)}
          </button>
        ))}
      </div>
      <div role="group" aria-label={t("format.align_label")} className="flex flex-wrap gap-1">
        {PPTX_ALIGN_MODES.map((mode: PptxAlignMode) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || !canAlign}
            data-pptx-align={mode}
            onClick={() => onApply(() => buildAlignEdit(slide, ids, mode, alignTo))}
          >
            {tRoot(formatAlignKey(mode))}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !canDistribute}
          data-testid="pptx-format-distribute-h"
          onClick={() => onApply(() => buildDistributeEdit(slide, ids, "horizontal", alignTo))}
        >
          {t("format.distribute_h")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !canDistribute}
          data-testid="pptx-format-distribute-v"
          onClick={() => onApply(() => buildDistributeEdit(slide, ids, "vertical", alignTo))}
        >
          {t("format.distribute_v")}
        </Button>
      </div>
    </section>
  );
}

export function PptxFormatTextSection({
  slide,
  elementId,
  blocked,
  allowed,
  onApply,
  textAnchor = null,
  autofit = null,
  wrapText = null,
}: PptxFormatTextSectionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const autofitItems = useMemo(() => PPTX_TEXT_AUTOFIT.map((value) => ({ value, label: t("format.autofit." + value) })), [t]);
  const inert = blocked || !allowed;

  return (
    <section aria-label={t("format.text_label")} data-pptx-format-section="text" className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{t("format.text_label")}</span>
      <div role="radiogroup" aria-label={t("format.anchor_label")} className="flex flex-wrap gap-2">
        {PPTX_TEXT_ANCHORS.map((anchor: PptxTextAnchor) => (
          <button
            key={anchor}
            type="button"
            role="radio"
            aria-checked={textAnchor === anchor}
            aria-label={t("format.anchor." + anchor)}
            data-pptx-anchor={anchor}
            disabled={inert}
            onClick={() => onApply(() => buildTextAnchorEdit(slide, elementId, anchor))}
            className={cn(
              "rounded-md border border-border bg-background px-2 py-1 text-caption",
              textAnchor === anchor && "border-primary ring-1 ring-primary",
              inert && "opacity-60",
            )}
          >
            {t("format.anchor." + anchor)}
          </button>
        ))}
      </div>
      <Select
        value={autofit ?? "none"}
        items={autofitItems}
        onValueChange={(value) => onApply(() => buildAutofitEdit(slide, elementId, value as PptxTextAutofit))}
      >
        <SelectTrigger aria-label={t("format.autofit_label")} data-testid="pptx-format-autofit" size="sm" disabled={inert} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PPTX_TEXT_AUTOFIT.map((value) => (
            <SelectItem key={value} value={value}>
              {t("format.autofit." + value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Checkbox
          id="pptx-format-wrap"
          aria-label={t("format.wrap")}
          checked={wrapText === true}
          disabled={inert}
          onCheckedChange={(checked) => onApply(() => buildWrapEdit(slide, elementId, checked === true))}
        />
        <Label htmlFor="pptx-format-wrap" className="text-body font-normal">
          {t("format.wrap")}
        </Label>
      </div>
    </section>
  );
}