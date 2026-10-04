"use client";

/**
 * Format panel sections, part 1 (A4ui, UNI-927): Fill, Line and Effects.
 *
 * Each section owns its own field state and reports exactly one committed
 * `FormatEdit` through the shared `onApply` callback, so the panel above stays
 * a small state machine (busy / error / honesty) and every control is testable
 * in isolation. Nothing here talks to the engine directly.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import type { FormatEdit } from "@uniwork/office-engine/pptx";
import {
  PPTX_FORMAT_DASHES,
  buildEffectsEdit,
  buildFillEdit,
  buildStrokeEdit,
  emuToPoints,
  formatColorInputValue,
  formatDashKey,
  isFormatColor,
  parseDegrees,
  parseNonNegative,
  parsePoints,
  type PptxFormatDash,
} from "./format-model";

export interface PptxFormatSectionProps {
  /** 0-based slide the edit targets. */
  slide: number;
  /** The selected element id. */
  elementId: string;
  /** No port / read-only / busy / no selection: every control is inert. */
  blocked: boolean;
  /** The engine would refuse this op for the selected element type. */
  allowed: boolean;
  /** Hand one built edit to the panel's channel. */
  onApply: (build: () => FormatEdit) => void;
  /** Current fill colour of the selection, for the field seed. */
  fillColor?: string | null;
  /** Current outline width in EMU, for the field seed. */
  strokeWidthEmu?: number | null;
}

export function PptxFormatFillSection({
  slide,
  elementId,
  blocked,
  allowed,
  onApply,
  fillColor = null,
}: PptxFormatSectionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [mode, setMode] = useState<"none" | "solid" | "gradient">("solid");
  const [solid, setSolid] = useState(fillColor ?? "#4472C4");
  const [from, setFrom] = useState("#4472C4");
  const [to, setTo] = useState("#FFFFFF");
  const [angle, setAngle] = useState("0");
  const [radial, setRadial] = useState(false);
  const inert = blocked || !allowed;

  return (
    <section aria-label={t("format.fill_label")} data-pptx-format-section="fill" className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{t("format.fill_label")}</span>
      <div role="radiogroup" aria-label={t("format.fill_label")} className="flex flex-wrap gap-2">
        {(["solid", "gradient", "none"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-label={t("format.fill." + value)}
            data-pptx-fill-mode={value}
            disabled={inert}
            onClick={() => setMode(value)}
            className={cn(
              "rounded-md border border-border bg-background px-2 py-1 text-caption",
              mode === value && "border-primary ring-1 ring-primary",
              inert && "opacity-60",
            )}
          >
            {t("format.fill." + value)}
          </button>
        ))}
      </div>
      {mode === "solid" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={t("format.fill_color")}
            value={formatColorInputValue(solid, "#4472C4")}
            disabled={inert}
            onChange={(event) => setSolid(event.target.value)}
            className="size-8 rounded-md border border-border bg-background"
          />
          <Input
            aria-label={t("format.fill_color")}
            data-testid="pptx-format-fill-hex"
            value={solid}
            disabled={inert}
            aria-invalid={isFormatColor(solid) ? undefined : true}
            onChange={(event) => setSolid(event.target.value)}
            className="w-28"
          />
        </div>
      ) : null}
      {mode === "gradient" ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("format.gradient_from")}
              data-testid="pptx-format-gradient-from"
              value={from}
              disabled={inert}
              onChange={(event) => setFrom(event.target.value)}
              className="w-28"
            />
            <Input
              aria-label={t("format.gradient_to")}
              data-testid="pptx-format-gradient-to"
              value={to}
              disabled={inert}
              onChange={(event) => setTo(event.target.value)}
              className="w-28"
            />
            <Input
              aria-label={t("format.gradient_angle")}
              data-testid="pptx-format-gradient-angle"
              inputMode="decimal"
              value={angle}
              disabled={inert}
              onChange={(event) => setAngle(event.target.value)}
              className="w-20"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="pptx-format-gradient-radial"
              aria-label={t("format.gradient_radial")}
              checked={radial}
              disabled={inert}
              onCheckedChange={(checked) => setRadial(checked === true)}
            />
            <Label htmlFor="pptx-format-gradient-radial" className="text-body font-normal">
              {t("format.gradient_radial")}
            </Label>
          </div>
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={inert}
        data-testid="pptx-format-apply-fill"
        onClick={() =>
          onApply(() =>
            mode === "none"
              ? buildFillEdit(slide, elementId, { kind: "none" })
              : mode === "solid"
                ? buildFillEdit(slide, elementId, { kind: "solid", color: solid })
                : buildFillEdit(slide, elementId, {
                    kind: "gradient",
                    from,
                    to,
                    angleDeg: parseDegrees(angle) ?? 0,
                    radial,
                  }),
          )
        }
      >
        {t("format.apply")}
      </Button>
    </section>
  );
}

export function PptxFormatLineSection({
  slide,
  elementId,
  blocked,
  allowed,
  onApply,
  strokeWidthEmu = null,
}: PptxFormatSectionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [on, setOn] = useState(true);
  const [color, setColor] = useState("#000000");
  const [width, setWidth] = useState(() => emuToPoints(strokeWidthEmu ?? 12700));
  const [dash, setDash] = useState<PptxFormatDash>("solid");
  const dashItems = useMemo(
    () => PPTX_FORMAT_DASHES.map((value) => ({ value, label: t(formatDashKey(value)) })),
    [t],
  );
  const inert = blocked || !allowed;

  return (
    <section aria-label={t("format.line_label")} data-pptx-format-section="line" className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{t("format.line_label")}</span>
      <div role="radiogroup" aria-label={t("format.line_label")} className="flex flex-wrap gap-2">
        {([true, false] as const).map((value) => (
          <button
            key={String(value)}
            type="button"
            role="radio"
            aria-checked={on === value}
            aria-label={value ? t("format.line.solid") : t("format.line.none")}
            data-pptx-line-mode={value ? "solid" : "none"}
            disabled={inert}
            onClick={() => setOn(value)}
            className={cn(
              "rounded-md border border-border bg-background px-2 py-1 text-caption",
              on === value && "border-primary ring-1 ring-primary",
              inert && "opacity-60",
            )}
          >
            {value ? t("format.line.solid") : t("format.line.none")}
          </button>
        ))}
      </div>
      {on ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={t("format.line_color")}
            value={formatColorInputValue(color, "#000000")}
            disabled={inert}
            onChange={(event) => setColor(event.target.value)}
            className="size-8 rounded-md border border-border bg-background"
          />
          <Input
            aria-label={t("format.line_width")}
            data-testid="pptx-format-line-width"
            inputMode="decimal"
            value={width}
            disabled={inert}
            aria-invalid={parsePoints(width) === null ? true : undefined}
            onChange={(event) => setWidth(event.target.value)}
            className="w-20"
          />
          <Select
            value={dash}
            items={dashItems}
            onValueChange={(value) => setDash(value as PptxFormatDash)}
          >
            <SelectTrigger
              aria-label={t("format.line_dash")}
              data-testid="pptx-format-line-dash"
              size="sm"
              disabled={inert}
              className="w-28"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PPTX_FORMAT_DASHES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(formatDashKey(value))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={inert}
        data-testid="pptx-format-apply-line"
        onClick={() =>
          onApply(() =>
            on
              ? buildStrokeEdit(slide, elementId, {
                  kind: "solid",
                  color,
                  widthPt: parsePoints(width) ?? 1,
                  dash,
                })
              : buildStrokeEdit(slide, elementId, { kind: "none" }),
          )
        }
      >
        {t("format.apply")}
      </Button>
    </section>
  );
}

export function PptxFormatEffectsSection({ slide, elementId, blocked, allowed, onApply }: PptxFormatSectionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [shadowOn, setShadowOn] = useState(false);
  const [shadowColor, setShadowColor] = useState("#000000");
  const [shadowBlur, setShadowBlur] = useState("4");
  const [shadowDist, setShadowDist] = useState("2");
  const [shadowDir, setShadowDir] = useState("45");
  const [glowOn, setGlowOn] = useState(false);
  const [glowColor, setGlowColor] = useState("#4472C4");
  const [glowRadius, setGlowRadius] = useState("6");
  const [softEdge, setSoftEdge] = useState("0");
  const inert = blocked || !allowed;

  return (
    <section aria-label={t("format.effects_label")} data-pptx-format-section="effects" className="flex flex-col gap-2">
      <span className="text-caption font-medium text-muted-foreground">{t("format.effects_label")}</span>
      <div className="flex items-center gap-2">
        <Checkbox
          id="pptx-format-shadow-on"
          aria-label={t("format.shadow_on")}
          checked={shadowOn}
          disabled={inert}
          onCheckedChange={(checked) => setShadowOn(checked === true)}
        />
        <Label htmlFor="pptx-format-shadow-on" className="text-body font-normal">
          {t("format.shadow_on")}
        </Label>
      </div>
      {shadowOn ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={t("format.shadow_color")}
            value={formatColorInputValue(shadowColor, "#000000")}
            disabled={inert}
            onChange={(event) => setShadowColor(event.target.value)}
            className="size-8 rounded-md border border-border bg-background"
          />
          <Input
            aria-label={t("format.shadow_blur")}
            data-testid="pptx-format-shadow-blur"
            inputMode="decimal"
            value={shadowBlur}
            disabled={inert}
            onChange={(event) => setShadowBlur(event.target.value)}
            className="w-16"
          />
          <Input
            aria-label={t("format.shadow_dist")}
            data-testid="pptx-format-shadow-dist"
            inputMode="decimal"
            value={shadowDist}
            disabled={inert}
            onChange={(event) => setShadowDist(event.target.value)}
            className="w-16"
          />
          <Input
            aria-label={t("format.shadow_dir")}
            data-testid="pptx-format-shadow-dir"
            inputMode="decimal"
            value={shadowDir}
            disabled={inert}
            onChange={(event) => setShadowDir(event.target.value)}
            className="w-16"
          />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id="pptx-format-glow-on"
          aria-label={t("format.glow_on")}
          checked={glowOn}
          disabled={inert}
          onCheckedChange={(checked) => setGlowOn(checked === true)}
        />
        <Label htmlFor="pptx-format-glow-on" className="text-body font-normal">
          {t("format.glow_label")}
        </Label>
      </div>
      {glowOn ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="color"
            aria-label={t("format.glow_color")}
            value={formatColorInputValue(glowColor, "#4472C4")}
            disabled={inert}
            onChange={(event) => setGlowColor(event.target.value)}
            className="size-8 rounded-md border border-border bg-background"
          />
          <Input
            aria-label={t("format.glow_radius")}
            data-testid="pptx-format-glow-radius"
            inputMode="decimal"
            value={glowRadius}
            disabled={inert}
            onChange={(event) => setGlowRadius(event.target.value)}
            className="w-16"
          />
        </div>
      ) : null}
      <Input
        aria-label={t("format.soft_edge_label")}
        data-testid="pptx-format-soft-edge"
        inputMode="decimal"
        value={softEdge}
        disabled={inert}
        onChange={(event) => setSoftEdge(event.target.value)}
        className="w-20"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        disabled={inert}
        data-testid="pptx-format-apply-effects"
        onClick={() =>
          onApply(() =>
            buildEffectsEdit(slide, elementId, {
              shadow: shadowOn
                ? {
                    color: shadowColor,
                    blurPt: parseNonNegative(shadowBlur) ?? 4,
                    distPt: parseNonNegative(shadowDist) ?? 2,
                    dirDeg: parseDegrees(shadowDir) ?? 45,
                  }
                : null,
              glow: glowOn ? { color: glowColor, radiusPt: parseNonNegative(glowRadius) ?? 6 } : null,
              softEdgePt: parseNonNegative(softEdge) ?? 0,
            }),
          )
        }
      >
        {t("format.apply")}
      </Button>
    </section>
  );
}