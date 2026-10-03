"use client";

// B9 (UNI-924): the Shape Format panel for the selected shape. Fill/outline and
// size map to textboxes[0] (patchShapeStyles / patchTextboxSizes at save);
// layout maps to imageWrap + imageOffsetXEmu/YEmu (applyImageWrap at save). The
// shape's text is edited in-canvas: double-click the shape.
import { useEffect, useState } from "react";
import { Paintbrush } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import {
  DOCX_SHAPE_WRAP_OPTIONS,
  docxShapeWrapEdit,
  parseOffsetPx,
  parseShapePx,
  type DocxShapeEdit,
  type DocxShapeInfo,
} from "./docx-shape-model";

const EMU_PER_PX = 9525;
/** Colour-input fallbacks when the shape has no fill/outline (document data:
 * the same Office defaults the insert helper seeds). */
const DEFAULT_FILL = "#4472C4";
const DEFAULT_OUTLINE = "#2F5496";

export function DocxShapePanel({
  disabled,
  shape,
  onEdit,
}: {
  /** No command runtime, read-only document or a save in flight. */
  disabled: boolean;
  shape: DocxShapeInfo | null;
  onEdit: (edit: DocxShapeEdit) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [offsetX, setOffsetX] = useState("");
  const [offsetY, setOffsetY] = useState("");

  const widthPx = shape?.widthPx ?? null;
  const heightPx = shape?.heightPx ?? null;
  const shapeOffsetX = shape?.offsetXEmu ?? null;
  const shapeOffsetY = shape?.offsetYEmu ?? null;
  useEffect(() => {
    setWidth(widthPx === null ? "" : String(widthPx));
  }, [widthPx]);
  useEffect(() => {
    setHeight(heightPx === null ? "" : String(heightPx));
  }, [heightPx]);
  useEffect(() => {
    setOffsetX(shapeOffsetX === null ? "" : String(Math.round(shapeOffsetX / EMU_PER_PX)));
  }, [shapeOffsetX]);
  useEffect(() => {
    setOffsetY(shapeOffsetY === null ? "" : String(Math.round(shapeOffsetY / EMU_PER_PX)));
  }, [shapeOffsetY]);

  const commitSize = () => {
    if (!shape) return;
    const nextWidth = parseShapePx(width);
    if (nextWidth === null) {
      setWidth(String(shape.widthPx));
      return;
    }
    // a bad height snaps back to the model without discarding a good width
    let nextHeight = shape.heightPx;
    if (!shape.straight) {
      const parsedHeight = parseShapePx(height);
      if (parsedHeight === null) setHeight(String(shape.heightPx));
      else nextHeight = parsedHeight;
    }
    if (nextWidth === shape.widthPx && nextHeight === shape.heightPx) return;
    onEdit({ kind: "size", widthPx: nextWidth, heightPx: nextHeight });
  };

  const commitOffset = () => {
    if (!shape || shape.wrap === null) return;
    const x = parseOffsetPx(offsetX);
    const y = parseOffsetPx(offsetY);
    if (x === null && y === null) {
      if (shape.offsetXEmu === null && shape.offsetYEmu === null) return;
      onEdit({ kind: "position", wrap: shape.wrap, offsetXEmu: null, offsetYEmu: null });
      return;
    }
    if (x === null || y === null) {
      setOffsetX(shape.offsetXEmu === null ? "" : String(Math.round(shape.offsetXEmu / EMU_PER_PX)));
      setOffsetY(shape.offsetYEmu === null ? "" : String(Math.round(shape.offsetYEmu / EMU_PER_PX)));
      return;
    }
    const xEmu = x * EMU_PER_PX;
    const yEmu = y * EMU_PER_PX;
    if (shape.offsetXEmu === xEmu && shape.offsetYEmu === yEmu) return;
    onEdit({ kind: "position", wrap: shape.wrap, offsetXEmu: xEmu, offsetYEmu: yEmu });
  };

  const fillHex = shape?.fill ?? null;
  const borderHex = shape?.borderColor ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled || !shape}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            aria-label={t("office.docx.shapes.format")}
            title={shape ? t("office.docx.shapes.format") : t("office.docx.shapes.noSelection")}
            aria-pressed={open}
            data-testid="docx-shape-format-open"
          >
            <Paintbrush aria-hidden />
          </Button>
        }
      />
      {shape ? (
        <PopoverContent align="end" className="w-72">
          <div className="grid gap-4">
            <div className="grid gap-1">
              <Label htmlFor="docx-shape-fill" className="text-caption text-muted-foreground">
                {t("office.docx.shapes.fill")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="docx-shape-fill"
                  type="color"
                  className="w-12"
                  value={fillHex ? `#${fillHex}` : DEFAULT_FILL}
                  disabled={disabled}
                  onChange={(event) => onEdit({ kind: "fill", color: event.target.value.replace(/^#/, "") })}
                  data-testid="docx-shape-fill"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || fillHex === null}
                  onClick={() => onEdit({ kind: "fill", color: null })}
                  data-testid="docx-shape-fill-none"
                >
                  {t("office.docx.shapes.fillNone")}
                </Button>
              </div>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="docx-shape-outline" className="text-caption text-muted-foreground">
                {t("office.docx.shapes.outline")}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="docx-shape-outline"
                  type="color"
                  className="w-12"
                  value={borderHex ? `#${borderHex}` : DEFAULT_OUTLINE}
                  disabled={disabled}
                  onChange={(event) => onEdit({ kind: "outline", color: event.target.value.replace(/^#/, "") })}
                  data-testid="docx-shape-outline"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled || borderHex === null}
                  onClick={() => onEdit({ kind: "outline", color: null })}
                  data-testid="docx-shape-outline-none"
                >
                  {t("office.docx.shapes.outlineNone")}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="docx-shape-width" className="text-caption text-muted-foreground">
                  {t("office.docx.shapes.width")}
                </Label>
                <Input
                  id="docx-shape-width"
                  inputMode="numeric"
                  value={width}
                  disabled={disabled}
                  onChange={(event) => setWidth(event.target.value)}
                  onBlur={commitSize}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitSize();
                  }}
                  data-testid="docx-shape-width"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="docx-shape-height" className="text-caption text-muted-foreground">
                  {t("office.docx.shapes.height")}
                </Label>
                <Input
                  id="docx-shape-height"
                  inputMode="numeric"
                  value={height}
                  disabled={disabled || shape.straight}
                  onChange={(event) => setHeight(event.target.value)}
                  onBlur={commitSize}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitSize();
                  }}
                  data-testid="docx-shape-height"
                />
              </div>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="docx-shape-wrap" className="text-caption text-muted-foreground">
                {t("office.docx.shapes.wrap")}
              </Label>
              <Select
                value={shape.wrap}
                disabled={disabled}
                items={DOCX_SHAPE_WRAP_OPTIONS.map((option) => ({ value: option.wrap, label: t(option.labelKey) }))}
                onValueChange={(value) => {
                  const edit = docxShapeWrapEdit(value, shape);
                  if (edit) onEdit(edit);
                }}
              >
                <SelectTrigger id="docx-shape-wrap" aria-label={t("office.docx.shapes.wrap")} className="w-full">
                  <SelectValue placeholder={t("office.docx.shapes.wrapDefault")} />
                </SelectTrigger>
                <SelectContent>
                  {DOCX_SHAPE_WRAP_OPTIONS.map((option) => (
                    <SelectItem key={option.wrap} value={option.wrap}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="docx-shape-offset-x" className="text-caption text-muted-foreground">
                  {t("office.docx.shapes.offsetX")}
                </Label>
                <Input
                  id="docx-shape-offset-x"
                  inputMode="numeric"
                  value={offsetX}
                  disabled={disabled || shape.wrap === null}
                  onChange={(event) => setOffsetX(event.target.value)}
                  onBlur={commitOffset}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitOffset();
                  }}
                  data-testid="docx-shape-offset-x"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="docx-shape-offset-y" className="text-caption text-muted-foreground">
                  {t("office.docx.shapes.offsetY")}
                </Label>
                <Input
                  id="docx-shape-offset-y"
                  inputMode="numeric"
                  value={offsetY}
                  disabled={disabled || shape.wrap === null}
                  onChange={(event) => setOffsetY(event.target.value)}
                  onBlur={commitOffset}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitOffset();
                  }}
                  data-testid="docx-shape-offset-y"
                />
              </div>
            </div>

            <p className="text-caption text-muted-foreground">{t("office.docx.shapes.textHint")}</p>
          </div>
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
