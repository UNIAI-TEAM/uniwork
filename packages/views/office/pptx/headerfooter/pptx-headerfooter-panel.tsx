"use client";

/**
 * Header & Footer panel (B7ui, UNI-927). The self-contained panel the
 * serialized UI-wire round mounts behind the Insert/Header & Footer command:
 * a footer text input, a slide-number toggle, a date input plus an
 * auto-date toggle, and Apply / Remove all.
 *
 * Contract. The panel is driven by one optional async port and the deck's
 * current settings, and it owns no session, no transport and no save path:
 *
 *   onApplyEdit?(edit: HeaderFooterEdit): Promise<unknown>  // engine edit channel
 *   onError?(error: unknown): void                          // host reporting seam
 *
 * `onApplyEdit` receives exactly the committed B7e `apply_header_footer` union
 * member, so the wire round is a one-line binding
 * (`(edit) => handle.edit([edit])` or `model.applyEdit(edit)`). With no port
 * bound every control is disabled and the panel says why - it never fakes a
 * capability (the lane's honesty rule).
 *
 * States: loading (a probe is in flight), empty (no deck), ready, busy (an edit
 * is applying), error (the last edit was refused; the message is shown and the
 * document is unchanged). The document is only ever mutated by `onApplyEdit`.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";
import type { HeaderFooterEdit, PptxHeaderFooterSettings } from "@uniwork/office-engine/pptx";
import {
  PPTX_HF_TEXT_MAX,
  buildHeaderFooterEdit,
  draftFromSettings,
  emptyHeaderFooterDraft,
  type PptxHeaderFooterDraft,
} from "./headerfooter-model";

export interface PptxHeaderFooterPanelProps {
  /** The engine edit channel (one committed `HeaderFooterEdit` per call).
   *  Absent -> every control is disabled with the "not bound" reason. */
  onApplyEdit?: (edit: HeaderFooterEdit) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** Deck slide count; 0 means "no deck" and the panel shows its empty state. */
  slideCount?: number;
  /** The deck's current header/footer settings, for the field seed. */
  settings?: PptxHeaderFooterSettings | null;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

export function PptxHeaderFooterPanel({
  onApplyEdit,
  onError,
  slideCount = 0,
  settings = null,
  loading = false,
  disabled = false,
  className,
}: PptxHeaderFooterPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [draft, setDraft] = useState<PptxHeaderFooterDraft>(() => draftFromSettings(settings));
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Latest busy flag for the synchronous guard: a second click during an
  // in-flight edit must not queue a duplicate transaction.
  const busyRef = useRef(false);

  const bound = typeof onApplyEdit === "function";
  const hasDeck = slideCount > 0;
  const blocked = disabled || !bound || !hasDeck || busy;

  const patch = (next: Partial<PptxHeaderFooterDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const run = useCallback(
    async (next: PptxHeaderFooterDraft): Promise<boolean> => {
      if (!onApplyEdit || busyRef.current) return false;
      const built = buildHeaderFooterEdit(next, settings);
      if (!built.ok) {
        // A refusal is explained in the panel (localized) and never sent.
        setErrorMessage(null);
        setNotice(
          built.code === "no_hf_changes"
            ? t("headerfooter.no_changes")
            : t("headerfooter.invalid_text", { max: PPTX_HF_TEXT_MAX }),
        );
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      setNotice(null);
      try {
        await onApplyEdit(built.value);
        return true;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        onError?.(error);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onApplyEdit, onError, settings, t],
  );

  const apply = () => {
    void run(draft);
  };

  const reset = () => {
    const cleared = emptyHeaderFooterDraft();
    setDraft(cleared);
    void run(cleared);
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("headerfooter.loading")}
        data-pptx-headerfooter-panel
        data-state="loading"
        className={cn("flex flex-col gap-3 p-3", className)}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!hasDeck) {
    return (
      <div
        data-pptx-headerfooter-panel
        data-state="empty"
        className={cn("p-3 text-caption text-muted-foreground", className)}
      >
        {t("headerfooter.empty")}
      </div>
    );
  }

  const blockedReason = disabled ? t("headerfooter.readonly") : !bound ? t("headerfooter.unbound") : null;

  return (
    <section
      aria-label={t("headerfooter.title")}
      data-pptx-headerfooter-panel
      data-state={busy ? "busy" : "ready"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3", className)}
    >
      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-headerfooter-error">
          <AlertTitle>{t("headerfooter.error_title")}</AlertTitle>
          <AlertDescription>{t("headerfooter.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-headerfooter-busy">
          {t("headerfooter.busy")}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pptx-hf-footer" className="text-caption font-medium text-muted-foreground">
          {t("headerfooter.footer_label")}
        </Label>
        <Input
          id="pptx-hf-footer"
          value={draft.footer}
          maxLength={PPTX_HF_TEXT_MAX}
          placeholder={t("headerfooter.footer_placeholder")}
          disabled={blocked}
          onChange={(event) => patch({ footer: event.target.value })}
        />
      </div>

      <span className="flex items-center justify-between gap-2">
        <span className="flex flex-col">
          <Label htmlFor="pptx-hf-slide-number" className="text-caption font-medium text-muted-foreground">
            {t("headerfooter.slide_number_label")}
          </Label>
          <span className="text-caption text-muted-foreground">{t("headerfooter.slide_number_hint")}</span>
        </span>
        <Switch
          id="pptx-hf-slide-number"
          nativeButton
          render={<button type="button" />}
          checked={draft.slideNum}
          disabled={blocked}
          aria-label={t("headerfooter.slide_number_label")}
          onCheckedChange={(checked) => patch({ slideNum: checked === true })}
        />
      </span>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pptx-hf-date" className="text-caption font-medium text-muted-foreground">
          {t("headerfooter.date_label")}
        </Label>
        <Input
          id="pptx-hf-date"
          value={draft.date}
          maxLength={PPTX_HF_TEXT_MAX}
          placeholder={t("headerfooter.date_placeholder")}
          disabled={blocked}
          onChange={(event) => patch({ date: event.target.value })}
        />
      </div>

      <span className="flex items-center justify-between gap-2">
        <span className="flex flex-col">
          <Label htmlFor="pptx-hf-date-auto" className="text-caption font-medium text-muted-foreground">
            {t("headerfooter.date_auto_label")}
          </Label>
          <span className="text-caption text-muted-foreground">{t("headerfooter.date_auto_hint")}</span>
        </span>
        <Switch
          id="pptx-hf-date-auto"
          nativeButton
          render={<button type="button" />}
          checked={draft.dateAuto}
          disabled={blocked}
          aria-label={t("headerfooter.date_auto_label")}
          onCheckedChange={(checked) => patch({ dateAuto: checked === true })}
        />
      </span>

      {notice ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-headerfooter-notice">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={blocked} data-pptx-headerfooter-apply onClick={apply}>
          {t("headerfooter.apply")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          title={t("headerfooter.reset_hint")}
          disabled={blocked}
          data-pptx-headerfooter-reset
          onClick={reset}
        >
          {t("headerfooter.reset")}
        </Button>
      </div>

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-headerfooter-unbound">
          {blockedReason}
        </p>
      ) : null}
    </section>
  );
}
