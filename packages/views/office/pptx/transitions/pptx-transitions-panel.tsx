"use client";

/**
 * B4ui (UNI-927) - the Transitions tab body (wave B4 UI half).
 *
 * A self-contained panel: it renders the transition gallery + the advance-timing
 * control and reports intents through its own props contract. It has NO write
 * port of its own - the later serialized UI-wire round registers it as the
 * Transitions tab and binds `onApplyTransition` / `onApplyAdvance` to the
 * session model's `set_transition` / `set_advance_time` edit kinds. Until then
 * it is honest: with no edit port it renders the controls disabled and says so.
 *
 * States covered: no slide selected (empty), reading (loading), read failure
 * (error + Retry), no edit port / read-only (disabled), an apply in flight
 * (pending). Nothing is written to the deck from here.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxTransitionKind } from "@uniwork/office-engine/pptx";
import { PptxAdvanceTiming } from "./advance-timing";
import { PptxTransitionGallery, resolveSelectedKind, transitionKindLabelKey } from "./transition-gallery";
import { ensurePptxTransitionsI18n } from "./transitions-i18n";

export interface PptxTransitionsPanelProps {
  /** 0-based slide the panel edits; null = no slide selected (empty state). */
  slideIndex: number | null;
  /** Current slide's transition kind, as read from the deck. */
  currentKind?: PptxTransitionKind | null;
  /** Current slide's auto-advance time in ms; null = no timer. */
  advanceMs?: number | null;
  /** The slide's transition is being read from the engine. */
  loading?: boolean;
  /** The read failed; the message is shown with a Retry. */
  error?: string | null;
  onRetry?: () => void;
  /** A transition / advance-time apply is in flight. */
  pending?: boolean;
  /** No edit port is bound, or the document is read-only: controls are inert. */
  disabled?: boolean;
  /** Explicit read-only document (its own note, distinct from "unbound"). */
  readOnly?: boolean;
  /** Apply a transition to the current slide, or to every slide. */
  onApplyTransition?: (kind: PptxTransitionKind, allSlides: boolean) => void;
  /** Set (ms >= 0) or clear (null) the current slide's auto-advance timer. */
  onApplyAdvance?: (ms: number | null) => void;
  className?: string;
}

export function PptxTransitionsPanel({
  slideIndex,
  currentKind,
  advanceMs = null,
  loading = false,
  error = null,
  onRetry,
  pending = false,
  disabled = false,
  readOnly = false,
  onApplyTransition,
  onApplyAdvance,
  className,
}: PptxTransitionsPanelProps) {
  // Lazy: the desktop renderer imports this module before i18n is initialized.
  ensurePptxTransitionsI18n();
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx.transitions" });
  const applyAllId = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const [applyAll, setApplyAll] = useState(false);
  const unbound = typeof onApplyTransition !== "function" && typeof onApplyAdvance !== "function";
  const inert = disabled || readOnly || pending || unbound || slideIndex === null;
  const selected = resolveSelectedKind(currentKind);

  return (
    <section
      aria-label={t("panel_label")}
      aria-busy={loading || pending || undefined}
      data-pptx-transitions-panel
      data-slide-index={slideIndex === null ? "" : String(slideIndex)}
      className={cn("flex min-h-0 flex-col gap-3 p-3 text-body", className)}
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-label font-semibold text-foreground">{t("panel_label")}</h2>
        <p className="text-caption text-muted-foreground" data-testid="pptx-transitions-current">
          {t("current", { name: t(transitionKindLabelKey(selected)) })}
        </p>
      </header>

      {error ? (
        <Alert variant="destructive" role="alert" data-testid="pptx-transitions-error">
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
        <p className="text-caption text-muted-foreground" data-testid="pptx-transitions-empty">{t("no_slide")}</p>
      ) : (
        <>
          {loading ? (
            <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-transitions-loading">
              {t("loading")}
            </p>
          ) : null}

          <PptxTransitionGallery
            currentKind={selected}
            disabled={inert || loading}
            {...(onApplyTransition ? { onPick: (kind: PptxTransitionKind) => onApplyTransition(kind, applyAll) } : {})}
          />

          {onApplyTransition ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={"pptx-transitions-apply-all-" + applyAllId}
                aria-label={t("apply_to_all")}
                checked={applyAll}
                disabled={inert || loading}
                onCheckedChange={(checked) => setApplyAll(checked === true)}
              />
              <Label htmlFor={"pptx-transitions-apply-all-" + applyAllId} className="text-body font-normal">
                {t("apply_to_all")}
              </Label>
            </div>
          ) : null}

          <PptxAdvanceTiming
            ms={advanceMs}
            disabled={inert || loading}
            pending={pending}
            onCommit={onApplyAdvance}
          />

          {unbound ? (
            <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-transitions-unbound">
              {t("unbound")}
            </p>
          ) : null}
          {readOnly && !unbound ? (
            <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-transitions-readonly">
              {t("readonly")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
