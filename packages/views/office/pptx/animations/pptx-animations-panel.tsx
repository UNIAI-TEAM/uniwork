"use client";

/**
 * B5ui (UNI-927) - the Animations tab body / Animations pane (wave B5 UI half).
 *
 * A self-contained panel: it lists the current slide's effects, adds one to the
 * selected shape, reorders, removes and (when a preview port is bound) previews.
 * It owns NO write port - the later serialized UI-wire round registers it as the
 * Animations tab and binds its callbacks to the session model's
 * `add_animation` / `remove_animation` / `reorder_animation` edit kinds. With
 * no port bound it renders the controls inert and says so, never a dead button.
 *
 * States: no slide (empty), no target shape (add disabled with a reason),
 * reading (loading), read failure (error + Retry), no port / read-only
 * (disabled), an apply in flight (pending).
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import { cn } from "@uniwork/ui/lib/utils";
import { PPTX_ANIM_EFFECTS, PPTX_ANIM_TRIGGERS, type PptxAnimEffect, type PptxAnimTrigger } from "@uniwork/office-engine/pptx";
import { PptxAnimationList } from "./animation-list";
import {
  animDefaultDurationMs,
  animEffectLabelKey,
  animTriggerLabelKey,
  msToSecondsText,
  parseSecondsToMs,
  resolveEffect,
  resolveTrigger,
  type PptxAnimationEntry,
} from "./animations-model";
import "./animations-i18n";

export interface PptxAnimationsPanelProps {
  /** 0-based slide the pane edits; null = no slide selected (empty state). */
  slideIndex: number | null;
  /** The slide's animation list, in play order. */
  entries: readonly PptxAnimationEntry[];
  /** Element the "add" targets (the current canvas selection); null = none. */
  targetElementId?: string | null;
  /** The list is being read from the engine. */
  loading?: boolean;
  /** The read failed; shown with a Retry. */
  error?: string | null;
  onRetry?: () => void;
  /** An apply is in flight. */
  pending?: boolean;
  /** No edit port is bound, or the document is read-only: controls are inert. */
  disabled?: boolean;
  readOnly?: boolean;
  /** Append an effect to the target element. */
  onAdd?: (entry: PptxAnimationEntry, elementId: string) => void;
  /** Remove the effect at an index. */
  onRemove?: (index: number) => void;
  /** Move the effect at `from` to `to`. */
  onReorder?: (from: number, to: number) => void;
  /** Play the slide's animations without committing anything. */
  onPreview?: () => void;
  className?: string;
}

export function PptxAnimationsPanel({
  slideIndex,
  entries,
  targetElementId = null,
  loading = false,
  error = null,
  onRetry,
  pending = false,
  disabled = false,
  readOnly = false,
  onAdd,
  onRemove,
  onReorder,
  onPreview,
  className,
}: PptxAnimationsPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.animations" });
  const idPrefix = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [effect, setEffect] = useState<PptxAnimEffect>("fade");
  const [trigger, setTrigger] = useState<PptxAnimTrigger>("onClick");
  const [duration, setDuration] = useState<string>(msToSecondsText(animDefaultDurationMs("fade")));
  const [delay, setDelay] = useState<string>("0");
  const [selected, setSelected] = useState(-1);

  const effectItems = useMemo(() => PPTX_ANIM_EFFECTS.map((kind) => ({ value: kind, label: t(animEffectLabelKey(kind)) })), [t]);
  const triggerItems = useMemo(() => PPTX_ANIM_TRIGGERS.map((kind) => ({ value: kind, label: t(animTriggerLabelKey(kind)) })), [t]);
  const durationParse = parseSecondsToMs(duration);
  const delayParse = parseSecondsToMs(delay);
  const timingValid = durationParse.kind === "ms" && delayParse.kind === "ms";
  const unbound = typeof onAdd !== "function" && typeof onRemove !== "function" && typeof onReorder !== "function";
  const inert = disabled || readOnly || pending || unbound || slideIndex === null;
  const canAdd = !inert && targetElementId !== null && timingValid && typeof onAdd === "function";

  const addEntry = () => {
    if (!canAdd || targetElementId === null) return;
    if (durationParse.kind !== "ms" || delayParse.kind !== "ms") return;
    onAdd?.({ effect, trigger, durationMs: durationParse.ms, delayMs: delayParse.ms }, targetElementId);
  };

  const pickEffect = (value: PptxAnimEffect) => {
    setEffect(value);
    // A fresh effect carries the vendored default duration, so the field never
    // shows a length that belonged to the previous effect.
    setDuration(msToSecondsText(animDefaultDurationMs(value)));
  };

  return (
    <section
      aria-label={t("panel_label")}
      aria-busy={loading || pending || undefined}
      data-pptx-animations-panel
      data-slide-index={slideIndex === null ? "" : String(slideIndex)}
      className={cn("flex min-h-0 flex-col gap-3 p-3 text-body", className)}
    >
      <h2 className="text-label font-semibold text-foreground">{t("panel_label")}</h2>

      {error ? (
        <Alert variant="destructive" role="alert" data-testid="pptx-animations-error">
          <AlertTitle>{t("error_title")}</AlertTitle>
          <AlertDescription>{t("error_hint", { message: error })}</AlertDescription>
          {onRetry ? (
            <div className="mt-2">
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t("retry")}</Button>
            </div>
          ) : null}
        </Alert>
      ) : null}

      {slideIndex === null ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-animations-empty-slide">{t("no_slide")}</p>
      ) : (
        <>
          {loading ? (
            <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-animations-loading">{t("loading")}</p>
          ) : null}

          <div className="flex flex-col gap-2 rounded-md border border-border p-2" data-pptx-animation-add>
            <span className="text-label font-medium text-foreground">{t("add_label")}</span>
            <div className="flex flex-col gap-1">
              <Label htmlFor={"pptx-anim-effect-" + idPrefix} className="text-caption text-muted-foreground">{t("effect_label")}</Label>
              <Select
                value={effect}
                items={effectItems}
                onValueChange={(value) => pickEffect(resolveEffect(value))}
              >
                <SelectTrigger id={"pptx-anim-effect-" + idPrefix} aria-label={t("effect_label")} className="w-full" disabled={inert || loading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PPTX_ANIM_EFFECTS.map((kind) => (
                    <SelectItem key={kind} value={kind}>{t(animEffectLabelKey(kind))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={"pptx-anim-trigger-" + idPrefix} className="text-caption text-muted-foreground">{t("trigger_label")}</Label>
              <Select
                value={trigger}
                items={triggerItems}
                onValueChange={(value) => setTrigger(resolveTrigger(value))}
              >
                <SelectTrigger id={"pptx-anim-trigger-" + idPrefix} aria-label={t("trigger_label")} className="w-full" disabled={inert || loading}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PPTX_ANIM_TRIGGERS.map((kind) => (
                    <SelectItem key={kind} value={kind}>{t(animTriggerLabelKey(kind))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={"pptx-anim-duration-" + idPrefix} className="text-caption text-muted-foreground">{t("duration_label")}</Label>
                <Input
                  id={"pptx-anim-duration-" + idPrefix}
                  inputMode="decimal"
                  value={duration}
                  disabled={inert || loading}
                  aria-invalid={durationParse.kind === "invalid" || undefined}
                  className="h-7 w-20"
                  onChange={(event) => setDuration(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={"pptx-anim-delay-" + idPrefix} className="text-caption text-muted-foreground">{t("delay_label")}</Label>
                <Input
                  id={"pptx-anim-delay-" + idPrefix}
                  inputMode="decimal"
                  value={delay}
                  disabled={inert || loading}
                  aria-invalid={delayParse.kind === "invalid" || undefined}
                  className="h-7 w-20"
                  onChange={(event) => setDelay(event.target.value)}
                />
              </div>
            </div>
            {!timingValid ? <p role="alert" className="text-caption text-destructive">{t("timing_invalid")}</p> : null}
            <p className="text-caption text-muted-foreground">{t("add_hint")}</p>
            {targetElementId === null ? (
              <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-animations-no-target">{t("no_target")}</p>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canAdd}
              data-testid="pptx-animation-add-button"
              onClick={addEntry}
            >
              <Plus aria-hidden />
              {t("add_label")}
            </Button>
          </div>

          <PptxAnimationList
            entries={entries}
            selected={selected}
            disabled={inert || loading}
            pending={pending}
            onSelect={setSelected}
            onMove={(index, delta) => onReorder?.(index, index + delta)}
            onRemove={(index) => {
              onRemove?.(index);
              setSelected((current) => (current === index ? -1 : current > index ? current - 1 : current));
            }}
            {...(onPreview ? { onPreview } : {})}
          />

          {unbound ? (
            <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-animations-unbound">{t("unbound")}</p>
          ) : null}
          {readOnly && !unbound ? (
            <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-animations-readonly">{t("readonly")}</p>
          ) : null}
          {pending ? <span role="status" className="text-caption text-muted-foreground" data-testid="pptx-animations-pending">{t("pending")}</span> : null}
        </>
      )}
    </section>
  );
}
