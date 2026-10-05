"use client";

/**
 * HtmlStylePanel — the H7 style panel over the H5/H6 selection.
 *
 * H5 publishes the selection, H6's float toolbar opens this panel; H7 renders
 * the controls. It is a PURE PRESENTATIONAL surface: it takes the current style
 * values and typed callbacks as props and renders them. It never reads the DOM,
 * never calls an H3 op, never sends an inspector command and never injects the
 * custom CSS anywhere - the CSS is reported as a plain string through
 * `onChange`, and the caller decides what becomes of it.
 *
 * Every control reports the narrowest patch it can: a typography change carries
 * only the typography group, a size change only the size group, and so on. The
 * image-only controls (alt, fit) render only when `isImage` is true, so a text
 * selection never shows them.
 *
 * Colours here are DOCUMENT values (what the person paints onto the element),
 * never theme tokens: the swatch fill is data the same way a document's own
 * `background` is.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Lock, LockOpen, RotateCcw } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select } from "@uniwork/ui/components/ui/select";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Slider } from "@uniwork/ui/components/ui/slider";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@uniwork/ui/components/ui/toggle-group";
import { cn } from "@uniwork/ui/lib/utils";
import { BackgroundColourField } from "./colour-field";
import {
  HTML_STYLE_ALIGNMENTS,
  HTML_STYLE_FONT_FAMILIES,
  HTML_STYLE_FONT_INHERIT,
  HTML_STYLE_FONT_WEIGHTS,
  HTML_STYLE_FITS,
  applyAspectLock,
  fontFamilyFromSelectValue,
  normalizeCustomCss,
  selectValueForFontFamily,
  type HtmlStyleAlign,
  type HtmlStyleFit,
  type HtmlStyleFontWeight,
  type HtmlStylePatch,
  type HtmlStyleValues,
} from "./model";

const ALIGN_ICONS: Record<HtmlStyleAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
};

const WEIGHT_KEYS: Record<HtmlStyleFontWeight, string> = {
  400: "weightRegular",
  500: "weightMedium",
  600: "weightSemibold",
  700: "weightBold",
};

const FIT_KEYS: Record<HtmlStyleFit, string> = {
  contain: "fitContain",
  cover: "fitCover",
  fill: "fitFill",
};

export interface HtmlStylePanelProps {
  /** The values the caller holds for the current selection. */
  values: HtmlStyleValues;
  /** True when the selection is an `<img>`: alt and fit are then shown. */
  isImage?: boolean;
  /** Renders every control inert; the panel still shows the current values. */
  disabled?: boolean;
  /** Reports the patch the person asked for. */
  onChange(patch: HtmlStylePatch): void;
  /** Reports "put the style back"; the caller owns what that means. */
  onRevert(): void;
  className?: string;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption font-medium text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/** The font-family rows: the built-in list, plus the current family when it is
 * not in it (a select must always be able to show the value it carries). */
function fontFamilyItems(current: string | null, inheritLabel: string) {
  const families = [...HTML_STYLE_FONT_FAMILIES];
  if (current !== null && !families.includes(current)) families.unshift(current);
  return [
    { value: HTML_STYLE_FONT_INHERIT, label: inheritLabel },
    ...families.map((family) => ({ value: family, label: family })),
  ];
}

export function HtmlStylePanel({ values, isImage = false, disabled = false, onChange, onRevert, className }: HtmlStylePanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.html.style" });

  return (
    <section
      aria-label={t("title")}
      data-testid="html-style-panel"
      data-style-image={isImage ? "true" : "false"}
      className={cn("flex w-72 flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-3 text-body shadow-[var(--menu-shadow)]", className)}
    >
      <Section title={t("typography")}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="html-style-font" className="text-caption text-muted-foreground">
            {t("fontFamily")}
          </Label>
          <Select
            id="html-style-font"
            aria-label={t("fontFamily")}
            triggerVariant="subtle"
            disabled={disabled}
            value={selectValueForFontFamily(values.fontFamily)}
            items={fontFamilyItems(values.fontFamily, t("fontFamilyInherit"))}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              onChange({ typography: { fontFamily: fontFamilyFromSelectValue(value) } });
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="html-style-weight" className="text-caption text-muted-foreground">
            {t("fontWeight")}
          </Label>
          <Select
            id="html-style-weight"
            aria-label={t("fontWeight")}
            triggerVariant="subtle"
            disabled={disabled}
            value={values.fontWeight === null ? "inherit" : String(values.fontWeight)}
            items={[
              { value: "inherit", label: t("fontWeightInherit") },
              ...HTML_STYLE_FONT_WEIGHTS.map((weight) => ({ value: String(weight), label: t(WEIGHT_KEYS[weight]) })),
            ]}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              const weight = HTML_STYLE_FONT_WEIGHTS.find((candidate) => String(candidate) === value);
              onChange({ typography: { fontWeight: weight ?? null } });
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-caption text-muted-foreground">{t("textAlign")}</span>
          <ToggleGroup
            value={values.textAlign === null ? [] : [values.textAlign]}
            disabled={disabled}
            aria-label={t("textAlign")}
            spacing={0}
            className="flex-1"
            data-testid="html-style-align"
            onValueChange={(next) => {
              const align = HTML_STYLE_ALIGNMENTS.find((candidate) => candidate === next[0]);
              onChange({ typography: { textAlign: align ?? null } });
            }}
          >
            {HTML_STYLE_ALIGNMENTS.map((align) => {
              const Icon = ALIGN_ICONS[align];
              return (
                <ToggleGroupItem key={align} value={align} aria-label={t(`align${align[0]!.toUpperCase()}${align.slice(1)}`)} data-align={align} className="h-7 px-2">
                  <Icon aria-hidden />
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      </Section>

      <Separator />

      <Section title={t("sizeSection")}>
        <div className="flex items-end gap-1.5">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="html-style-width" className="text-caption text-muted-foreground">
              {t("sizeWidth")}
            </Label>
            <Input
              id="html-style-width"
              type="number"
              inputMode="numeric"
              min={1}
              disabled={disabled}
              value={values.size.width ?? ""}
              data-testid="html-style-width"
              onChange={(event) => {
                const raw = event.target.value;
                const next = raw === "" ? null : Number(raw);
                onChange({ size: pickSize(applyAspectLock(values.size, "width", Number.isFinite(next) ? next : null)) });
              }}
            />
          </div>
          <Button
            type="button"
            variant="toolbar"
            size="icon-sm"
            disabled={disabled}
            aria-pressed={values.size.aspectLocked}
            aria-label={t("lockAspect")}
            data-testid="html-style-aspect-lock"
            onClick={() => onChange({ size: { aspectLocked: !values.size.aspectLocked } })}
          >
            {values.size.aspectLocked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
          </Button>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="html-style-height" className="text-caption text-muted-foreground">
              {t("sizeHeight")}
            </Label>
            <Input
              id="html-style-height"
              type="number"
              inputMode="numeric"
              min={1}
              disabled={disabled}
              value={values.size.height ?? ""}
              data-testid="html-style-height"
              onChange={(event) => {
                const raw = event.target.value;
                const next = raw === "" ? null : Number(raw);
                onChange({ size: pickSize(applyAspectLock(values.size, "height", Number.isFinite(next) ? next : null)) });
              }}
            />
          </div>
        </div>
      </Section>

      <Separator />

      <Section title={t("appearance")}>
        <BackgroundColourField value={values.background} disabled={disabled} onPick={(background) => onChange({ background })} />
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-caption text-muted-foreground">{t("opacity")}</span>
            <span
              className="text-caption tabular-nums text-muted-foreground"
              data-testid="html-style-opacity-value"
              data-opacity-percent={values.opacity}
            >
              {t("opacityValue", { percent: values.opacity })}
            </span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            aria-label={t("opacity")}
            value={[values.opacity]}
            data-testid="html-style-opacity"
            onValueChange={(next) => {
              const percent = Array.isArray(next) ? next[0] : next;
              if (typeof percent === "number") onChange({ opacity: percent });
            }}
          />
        </div>
      </Section>

      {isImage ? (
        <>
          <Separator />
          <Section title={t("imageSection")}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="html-style-alt" className="text-caption text-muted-foreground">
                {t("imageAlt")}
              </Label>
              <Input
                id="html-style-alt"
                value={values.alt ?? ""}
                disabled={disabled}
                data-testid="html-style-alt"
                onChange={(event) => onChange({ alt: event.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">{t("imageFit")}</span>
              <ToggleGroup
                value={values.fit === null ? [] : [values.fit]}
                disabled={disabled}
                aria-label={t("imageFit")}
                spacing={0}
                className="flex-1"
                data-testid="html-style-fit"
                onValueChange={(next) => {
                  const fit = HTML_STYLE_FITS.find((candidate) => candidate === next[0]);
                  onChange({ fit: fit ?? null });
                }}
              >
                {HTML_STYLE_FITS.map((fit) => (
                  <ToggleGroupItem key={fit} value={fit} aria-label={t(FIT_KEYS[fit])} data-fit={fit} className="h-7 flex-1 px-2 text-label">
                    {t(FIT_KEYS[fit])}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </Section>
        </>
      ) : null}

      <Separator />

      <Section title={t("customCss")}>
        <Label htmlFor="html-style-custom-css" className="sr-only">
          {t("customCss")}
        </Label>
        <Textarea
          id="html-style-custom-css"
          value={values.customCss}
          disabled={disabled}
          spellCheck={false}
          rows={3}
          placeholder={t("customCssPlaceholder")}
          className="font-mono text-caption"
          data-testid="html-style-custom-css"
          onChange={(event) => onChange({ customCss: normalizeCustomCss(event.target.value) })}
        />
      </Section>

      <Separator />

      <Button type="button" variant="outline" disabled={disabled} data-testid="html-style-revert" onClick={onRevert}>
        <RotateCcw aria-hidden />
        {t("revert")}
      </Button>
    </section>
  );
}

/** A size patch from the model's next size: only the two dimensions travel. */
function pickSize(size: HtmlStyleValues["size"]): NonNullable<HtmlStylePatch["size"]> {
  return { width: size.width, height: size.height };
}
