"use client";

/**
 * Text-format panel (UNI-927, task WIRE-TEXT). The self-contained, presentational
 * body the serialized WIRE-MOUNT round mounts for a selected text/shape element:
 * bold, italic, underline, strike, font family, font size, text colour, highlight
 * (honestly disabled - see the model's KNOWN GAP), horizontal alignment,
 * bullets / numbering and line spacing.
 *
 * Contract. The panel is driven by ONE optional async port and the host's
 * selection, and it owns no session, no transport and no save path:
 *
 *   onApplyEdit?(edit: TextEdit): Promise<unknown>   // the engine edit channel
 *   onApplyEdits?(edits: TextEdit[]): Promise<unknown> // one call per gesture
 *   onError?(error: unknown): void                   // host reporting seam
 *
 * Every control emits one committed `TextEdit` union member (`set_font` or
 * `set_paragraph_format`) per target id, built by `./text-format-model`. The
 * targets are `targetIds` (every selected text element, anchor first - the same
 * set the ribbon formats, W9 review F6) or the anchor alone, and one gesture is
 * one `onApplyEdits` call so undo reverts it in one step. With no port bound, no element selected, a non-text element type, or
 * read-only mode, every control is disabled and the panel says why - it never
 * fakes a capability (the lane's honesty rule).
 *
 * States: loading (a probe is in flight), empty (nothing selected), ready, busy
 * (an edit is applying - a second click is refused), error (the last edit was
 * refused; the message is shown and the document is unchanged).
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import { PPTX_TEXT_ALIGNS, type PptxTextAlign, type TextEdit } from "@uniwork/office-engine/pptx";
import {
  PPTX_TEXT_BULLET_OPTIONS,
  PPTX_TEXT_FONT_FAMILIES,
  PPTX_TEXT_FONT_SIZE_PT_PRESETS,
  PPTX_TEXT_FONT_TOGGLES,
  PPTX_TEXT_LINE_SPACING_PCT_PRESETS,
  buildAlignEdit,
  buildBulletEdit,
  buildFontFamilyEdit,
  buildFontSizeEdit,
  buildFontToggleEdit,
  buildLineSpacingEdit,
  buildTextColorEdit,
  parsePptxFontSizePt,
  parsePptxLineSpacingPct,
  pptxColorInputValue,
  pptxTextFormatAllowed,
  type PptxTextBulletChoice,
  type PptxTextFontToggle,
} from "./text-format-model";
import { buildPptxTextEditBatch } from "./text-format-batch";
import "./text-i18n";

export interface PptxTextFormatPanelProps {
  /** The engine edit channel (one committed `TextEdit` per call). Absent ->
   *  every control is disabled with the "not bound" reason. */
  onApplyEdit?: (edit: TextEdit) => Promise<unknown>;
  /** One gesture's edits in a single call; preferred over `onApplyEdit`. */
  onApplyEdits?: (edits: readonly TextEdit[]) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** 0-based slide the selection lives on; null means "no slide". */
  slideIndex?: number | null;
  /** The selected element id (the edit target); null = none. */
  selectedElementId?: string | null;
  /** Type of the selected element ('text' | 'shape' | ...); the committed kinds
   *  accept text and shape only, so anything else disables the controls. */
  selectedElementType?: string | null;
  /** Every selected id that takes text formatting, anchor first; absent = the anchor. */
  targetIds?: readonly string[];
  /** Seed values for the controls (the selection's current formatting). */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontFamily?: string;
  fontSizePt?: number;
  textColor?: string;
  align?: PptxTextAlign;
  bullet?: PptxTextBulletChoice;
  lineSpacingPct?: number;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

const DEFAULT_FAMILY = "Calibri";
const DEFAULT_COLOR = "#000000";

export function PptxTextFormatPanel({
  onApplyEdit,
  onApplyEdits,
  onError,
  slideIndex = null,
  selectedElementId = null,
  selectedElementType = null,
  targetIds,
  bold = false,
  italic = false,
  underline = false,
  strike = false,
  fontFamily = DEFAULT_FAMILY,
  fontSizePt = 18,
  textColor = DEFAULT_COLOR,
  align = "left",
  bullet = "none",
  lineSpacingPct = 100,
  loading = false,
  disabled = false,
  className,
}: PptxTextFormatPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.text" });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busyRef = useRef(false);

  const [toggles, setToggles] = useState<Record<PptxTextFontToggle, boolean>>({ bold, italic, underline, strike });
  const [family, setFamily] = useState(fontFamily);
  const [size, setSize] = useState(String(fontSizePt));
  const [color, setColor] = useState(textColor);
  const [alignment, setAlignment] = useState<PptxTextAlign>(align);
  const [bulletChoice, setBulletChoice] = useState<PptxTextBulletChoice>(bullet);
  const [spacing, setSpacing] = useState(String(lineSpacingPct));

  const bound = typeof onApplyEdit === "function" || typeof onApplyEdits === "function";
  const hasSelection = typeof selectedElementId === "string" && selectedElementId.length > 0;
  const typeAllowed = pptxTextFormatAllowed(selectedElementType);
  const blocked = disabled || !bound || !hasSelection || !typeAllowed || busy;
  const slide = slideIndex === null ? 0 : slideIndex;

  const run = useCallback(
    (build: (elementId: string) => TextEdit): void => {
      const send = onApplyEdits ?? (onApplyEdit ? async (edits: readonly TextEdit[]) => { for (const edit of edits) await onApplyEdit(edit); } : undefined);
      if (!send || busyRef.current || !hasSelection) return;
      const report = (error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        onError?.(error);
      };
      // Refused ids are skipped; the first refusal is reported once.
      const { edits, refusal } = buildPptxTextEditBatch(selectedElementId, targetIds, build);
      if (edits.length === 0) {
        report(refusal);
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      if (refusal !== null) report(refusal);
      void send(edits)
        .catch(report)
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [hasSelection, onApplyEdit, onApplyEdits, onError, selectedElementId, targetIds],
  );

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("format.loading")}
        data-pptx-text-format-panel
        data-state="loading"
        className={cn("p-3 text-caption text-muted-foreground", className)}
      >
        {t("format.loading")}
      </div>
    );
  }

  const blockedReason = disabled
    ? t("format.readonly")
    : !bound
      ? t("format.unbound")
      : !typeAllowed
        ? t("format.unsupported")
        : null;

  return (
    <section
      aria-label={t("format.title")}
      data-pptx-text-format-panel
      data-state={busy ? "busy" : hasSelection ? "ready" : "empty"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3 text-body", className)}
    >
      <h2 className="text-label font-semibold text-foreground">{t("format.title")}</h2>

      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-text-format-error">
          <AlertTitle>{t("format.error_title")}</AlertTitle>
          <AlertDescription>{t("format.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-text-format-busy">
          {t("format.busy")}
        </p>
      ) : null}

      {!hasSelection ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-text-format-empty">
          {t("format.empty")}
        </p>
      ) : null}

      {/* Character toggles */}
      <div role="group" aria-label={t("format.char_label")} className="flex flex-wrap gap-2">
        {PPTX_TEXT_FONT_TOGGLES.map((toggle) => (
          <Button
            key={toggle}
            type="button"
            size="sm"
            variant={toggles[toggle] ? "default" : "outline"}
            aria-pressed={toggles[toggle]}
            aria-label={t("format.toggle." + toggle)}
            data-testid={"pptx-text-toggle-" + toggle}
            disabled={blocked}
            onClick={() => {
              const next = !toggles[toggle];
              setToggles((current) => ({ ...current, [toggle]: next }));
              run((id) => buildFontToggleEdit(slide, id, toggle, next));
            }}
          >
            {t("format.toggle." + toggle)}
          </Button>
        ))}
      </div>

      {/* Font family + size */}
      <div className="flex flex-wrap items-end gap-2" data-pptx-font-row>
        <div className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">{t("format.font_family")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={family}
              items={PPTX_TEXT_FONT_FAMILIES.map((value) => ({ value, label: value }))}
              onValueChange={(value) => {
                if (value === null) return;
                setFamily(value);
                run((id) => buildFontFamilyEdit(slide, id, value));
              }}
            >
              <SelectTrigger aria-label={t("format.font_family")} data-testid="pptx-text-font-family" size="sm" disabled={blocked} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPTX_TEXT_FONT_FAMILIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t("format.font_family_custom")}
              data-testid="pptx-text-font-family-custom"
              value={family}
              disabled={blocked}
              aria-invalid={family.trim().length === 0 ? true : undefined}
              onChange={(event) => setFamily(event.target.value)}
              className="w-32"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="pptx-text-apply-font-family"
              disabled={blocked || family.trim().length === 0}
              onClick={() => run((id) => buildFontFamilyEdit(slide, id, family))}
            >
              {t("format.apply")}
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 max-w-full flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">{t("format.font_size")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={size}
              items={PPTX_TEXT_FONT_SIZE_PT_PRESETS.map((value) => ({ value: String(value), label: String(value) }))}
              onValueChange={(value) => {
                if (value === null) return;
                setSize(value);
                const parsed = parsePptxFontSizePt(value);
                if (parsed !== null) run((id) => buildFontSizeEdit(slide, id, parsed));
              }}
            >
              <SelectTrigger aria-label={t("format.font_size")} data-testid="pptx-text-font-size" size="sm" disabled={blocked} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PPTX_TEXT_FONT_SIZE_PT_PRESETS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {String(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t("format.font_size_custom")}
              data-testid="pptx-text-font-size-custom"
              inputMode="decimal"
              value={size}
              disabled={blocked}
              aria-invalid={parsePptxFontSizePt(size) === null ? true : undefined}
              onChange={(event) => setSize(event.target.value)}
              className="w-20"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="pptx-text-apply-size"
              disabled={blocked || parsePptxFontSizePt(size) === null}
              onClick={() => {
                const parsed = parsePptxFontSizePt(size);
                if (parsed !== null) run((id) => buildFontSizeEdit(slide, id, parsed));
              }}
            >
              {t("format.apply")}
            </Button>
          </div>
        </div>
      </div>

      {/* Text colour + highlight */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">{t("format.text_color")}</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t("format.text_color")}
              value={pptxColorInputValue(color, DEFAULT_COLOR)}
              disabled={blocked}
              onChange={(event) => {
                setColor(event.target.value);
                run((id) => buildTextColorEdit(slide, id, event.target.value));
              }}
              className="size-8 rounded-md border border-border bg-background"
            />
            <Input
              aria-label={t("format.text_color")}
              data-testid="pptx-text-color"
              value={color}
              disabled={blocked}
              aria-invalid={pptxColorInputValue(color, "") === "" ? true : undefined}
              onChange={(event) => setColor(event.target.value)}
              className="w-28"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="pptx-text-apply-color"
              disabled={blocked || pptxColorInputValue(color, "") === ""}
              onClick={() => run((id) => buildTextColorEdit(slide, id, color))}
            >
              {t("format.apply")}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-muted-foreground">{t("format.highlight")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="pptx-text-highlight"
            disabled
            title={t("format.highlight_unavailable")}
          >
            {t("format.highlight_unavailable")}
          </Button>
        </div>
      </div>

      {/* Horizontal alignment */}
      <div className="flex flex-col gap-1">
        <span className="text-caption font-medium text-muted-foreground">{t("format.align_label")}</span>
        <div role="radiogroup" aria-label={t("format.align_label")} className="flex flex-wrap gap-2">
          {PPTX_TEXT_ALIGNS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={alignment === value}
              aria-label={t("format.align." + value)}
              data-pptx-text-align={value}
              disabled={blocked}
              onClick={() => {
                setAlignment(value);
                run((id) => buildAlignEdit(slide, id, value));
              }}
              className={cn(
                "rounded-md border border-border bg-background px-2 py-1 text-caption",
                alignment === value && "border-primary ring-1 ring-primary",
                blocked && "opacity-60",
              )}
            >
              {t("format.align." + value)}
            </button>
          ))}
        </div>
      </div>

      {/* Bullets / numbering */}
      <div className="flex flex-col gap-1">
        <span className="text-caption font-medium text-muted-foreground">{t("format.bullet_label")}</span>
        <div role="radiogroup" aria-label={t("format.bullet_label")} className="flex flex-wrap gap-2">
          {PPTX_TEXT_BULLET_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={bulletChoice === value}
              aria-label={t("format.bullet." + value)}
              data-pptx-text-bullet={value}
              disabled={blocked}
              onClick={() => {
                setBulletChoice(value);
                run((id) => buildBulletEdit(slide, id, value));
              }}
              className={cn(
                "rounded-md border border-border bg-background px-2 py-1 text-caption",
                bulletChoice === value && "border-primary ring-1 ring-primary",
                blocked && "opacity-60",
              )}
            >
              {t("format.bullet." + value)}
            </button>
          ))}
        </div>
      </div>

      {/* Line spacing */}
      <div className="flex flex-col gap-1">
        <span className="text-caption font-medium text-muted-foreground">{t("format.line_spacing")}</span>
        <div className="flex items-center gap-2">
          <Select
            value={spacing}
            items={PPTX_TEXT_LINE_SPACING_PCT_PRESETS.map((value) => ({ value: String(value), label: String(value) + "%" }))}
            onValueChange={(value) => {
              if (value === null) return;
              setSpacing(value);
              const parsed = parsePptxLineSpacingPct(value);
              if (parsed !== null) run((id) => buildLineSpacingEdit(slide, id, parsed));
            }}
          >
            <SelectTrigger aria-label={t("format.line_spacing")} data-testid="pptx-text-line-spacing" size="sm" disabled={blocked} className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PPTX_TEXT_LINE_SPACING_PCT_PRESETS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {String(value)}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={t("format.line_spacing_custom")}
            data-testid="pptx-text-line-spacing-custom"
            inputMode="numeric"
            value={spacing}
            disabled={blocked}
            aria-invalid={parsePptxLineSpacingPct(spacing) === null ? true : undefined}
            onChange={(event) => setSpacing(event.target.value)}
            className="w-20"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="pptx-text-apply-spacing"
            disabled={blocked || parsePptxLineSpacingPct(spacing) === null}
            onClick={() => {
              const parsed = parsePptxLineSpacingPct(spacing);
              if (parsed !== null) run((id) => buildLineSpacingEdit(slide, id, parsed));
            }}
          >
            {t("format.apply")}
          </Button>
        </div>
      </div>

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-text-format-unbound">
          {blockedReason}
        </p>
      ) : null}
    </section>
  );
}