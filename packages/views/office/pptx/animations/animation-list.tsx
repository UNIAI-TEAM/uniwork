"use client";

/**
 * B5ui (UNI-927) - the Animations pane's effect list.
 *
 * Presentational: it renders the ordered effects with their step number, class
 * badge, trigger and timing, and reports reorder / remove / preview intents
 * through props. It never writes the deck.
 *
 * Accessibility: the list is a `list` of rows; each row is a `listitem`
 * holding a select button (aria-pressed reflects the pane selection) and the
 * per-row actions. Up/down/remove carry accessible names that include the
 * effect so a screen reader can tell the rows apart.
 */
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Play, Trash2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import {
  animClassLabelKey,
  animEffectClass,
  animEffectLabelKey,
  animStepNumbers,
  animTriggerLabelKey,
  type PptxAnimationEntry,
} from "./animations-model";

export interface PptxAnimationListProps {
  entries: readonly PptxAnimationEntry[];
  /** Selected row index, or -1 for none. */
  selected: number;
  onSelect: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
  /** Absent when no preview port is bound; the button is then disabled. */
  onPreview?: () => void;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}

export function PptxAnimationList({
  entries,
  selected,
  onSelect,
  onMove,
  onRemove,
  onPreview,
  disabled = false,
  pending = false,
  className,
}: PptxAnimationListProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.animations" });
  const steps = animStepNumbers(entries);
  const inert = disabled || pending;
  return (
    <div className={cn("flex min-h-0 flex-col gap-1", className)} data-pptx-animation-list>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-medium text-foreground">{t("list_label")}</span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("preview")}
          title={typeof onPreview === "function" ? t("preview") : t("preview_unbound")}
          disabled={inert || entries.length === 0 || typeof onPreview !== "function"}
          data-testid="pptx-animation-preview"
          onClick={() => onPreview?.()}
        >
          <Play aria-hidden />
        </Button>
      </div>
      <p className="text-caption text-muted-foreground">{t("list_hint")}</p>
      {entries.length === 0 ? (
        <div className="flex flex-col gap-0.5 rounded-md border border-dashed border-border p-3" data-testid="pptx-animation-empty">
          <span className="text-body text-foreground">{t("empty")}</span>
          <span className="text-caption text-muted-foreground">{t("empty_hint")}</span>
        </div>
      ) : (
        <ol aria-label={t("list_label")} className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {entries.map((entry, index) => {
            const step = steps[index] ?? null;
            const effectLabel = t(animEffectLabelKey(entry.effect));
            const triggerLabel = t(animTriggerLabelKey(entry.trigger));
            const isSelected = selected === index;
            return (
              <li
                key={index}
                data-animation-row={index}
                data-selected={isSelected}
                className={cn(
                  "flex items-center gap-2 rounded-md border border-border bg-background p-1.5",
                  isSelected && "border-primary bg-muted/40",
                )}
              >
                <span className="w-10 shrink-0 text-caption text-muted-foreground" data-testid="pptx-animation-step">
                  {step === null ? t("auto_step") : t("step", { n: String(step) })}
                </span>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={t("row_aria", { effect: effectLabel, trigger: triggerLabel })}
                  disabled={inert}
                  onClick={() => onSelect(isSelected ? -1 : index)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body text-foreground">{effectLabel}</span>
                    <span className="shrink-0 rounded-sm border border-border px-1 text-micro text-muted-foreground">
                      {t(animClassLabelKey(animEffectClass(entry.effect)))}
                    </span>
                  </span>
                  <span className="truncate text-caption text-muted-foreground">
                    {t("row_timing", { trigger: triggerLabel, duration: msToSecondsLabel(entry.durationMs) })}
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-0.5">
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("move_up")} disabled={inert || index === 0} onClick={() => onMove(index, -1)}>
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("move_down")} disabled={inert || index === entries.length - 1} onClick={() => onMove(index, 1)}>
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("remove")} disabled={inert} onClick={() => onRemove(index)}>
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** A plain seconds label for a row's subtitle ("1.5 s"). Kept local because it
 * is a display detail, not a rule the model needs. */
function msToSecondsLabel(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return String(Number(seconds.toFixed(2))) + "s";
}
