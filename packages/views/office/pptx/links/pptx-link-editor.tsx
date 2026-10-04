"use client";

/**
 * Hyperlink editor (A6ui, UNI-927).
 *
 * Sets, edits or removes a hyperlink on the selected element. The three link
 * shapes the vendored `setLink` op accepts are offered as modes - a web
 * address, a jump to a slide, or a named show action - and the fields are
 * pre-flighted by `validateLinkDraft` so a control never sends a link the
 * engine would refuse.
 *
 * Contract. It owns no session and no deck; it is driven by one optional port:
 *
 *   onSetLink?(edit: PptxSetLinkEdit): Promise<unknown> | void
 *
 * `onSetLink` receives exactly the registered `set_link` engine kind (a null
 * `link` removes the hyperlink), so the wire round is a one-line binding
 * (`(edit) => handle.edit([edit])`). With no element selected or no port bound
 * the controls are disabled and the panel says why.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import { PPTX_NAMED_ACTIONS, type PptxLinkTarget } from "@uniwork/office-engine/pptx";
import {
  PPTX_LINK_MODES,
  buildSetLinkEdit,
  draftFromLink,
  linkSummary,
  validateLinkDraft,
  type PptxLinkDraft,
  type PptxLinkMode,
  type PptxSetLinkEdit,
} from "./pptx-link-model";

export interface PptxLinkEditorProps {
  /** 0-based selected slide; null when no slide is bound. */
  slideIndex: number | null;
  /** The selected element's id; null when the selection is not one element. */
  elementId?: string | null;
  /** The element's current link, for the echo and to enable Remove. */
  link?: PptxLinkTarget | null;
  /** Deck slide count, for the "go to slide" field bound. */
  slideCount?: number;
  /** The engine edit channel. Absent -> every control is disabled. */
  onSetLink?: (edit: PptxSetLinkEdit) => Promise<unknown> | void;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** An edit is in flight. */
  busy?: boolean;
  /** Read-only document. */
  readonly?: boolean;
  onClose?: () => void;
  className?: string;
}

export function PptxLinkEditor({
  slideIndex,
  elementId = null,
  link = null,
  slideCount = 0,
  onSetLink,
  onError,
  busy = false,
  readonly = false,
  onClose,
  className,
}: PptxLinkEditorProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [draft, setDraft] = useState<PptxLinkDraft>(() => draftFromLink(link));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The bound link is the source of truth: a selection change or a completed
  // edit re-seeds the fields. A refused edit leaves `link` unchanged, so the
  // draft survives and the user does not lose what they typed.
  useEffect(() => {
    setDraft(draftFromLink(link));
  }, [link, elementId, slideIndex]);

  const bound = typeof onSetLink === "function";
  const inFlight = busy || pending;
  const hasTarget = slideIndex !== null && !!elementId;
  const blocked = readonly || !bound || inFlight || !hasTarget;

  const validation = validateLinkDraft(draft, slideCount);
  const current = linkSummary(link);

  const run = async (edit: PptxSetLinkEdit): Promise<void> => {
    if (!onSetLink || inFlight) return;
    setPending(true);
    setErrorMessage(null);
    try {
      await onSetLink(edit);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      onError?.(error);
    } finally {
      setPending(false);
    }
  };

  const apply = () => {
    if (!hasTarget || slideIndex === null || !elementId || !validation.ok) return;
    void run(buildSetLinkEdit(slideIndex, elementId, validation.link));
  };

  const remove = () => {
    if (!hasTarget || slideIndex === null || !elementId) return;
    void run(buildSetLinkEdit(slideIndex, elementId, null));
  };

  const blockedReason = readonly
    ? t("links.readonly")
    : !bound
      ? t("links.unbound")
      : !hasTarget
        ? t("links.no_selection")
        : null;

  return (
    <section
      aria-label={t("links.title")}
      data-pptx-link-editor
      data-state={inFlight ? "busy" : "ready"}
      className={cn("flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3", className)}
    >
      <div role="radiogroup" aria-label={t("links.mode_label")} className="flex flex-wrap gap-1">
        {PPTX_LINK_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={draft.mode === mode}
            aria-label={t(`links.mode_${mode}`)}
            disabled={blocked}
            data-link-mode={mode}
            className={cn(
              "rounded-control px-2 py-1 text-caption",
              draft.mode === mode ? "bg-surface-selected text-foreground" : "text-muted-foreground hover:bg-muted",
            )}
            onClick={() => setDraft((current) => ({ ...current, mode: mode as PptxLinkMode }))}
          >
            {t(`links.mode_${mode}`)}
          </button>
        ))}
      </div>

      {draft.mode === "url" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pptx-link-url">{t("links.url_label")}</Label>
          <Input
            id="pptx-link-url"
            value={draft.url}
            aria-label={t("links.url_label")}
            aria-invalid={!validation.ok}
            placeholder={t("links.url_placeholder")}
            className="h-7"
            data-pptx-link-url
            disabled={blocked}
            onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
          />
        </div>
      ) : null}

      {draft.mode === "slide" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pptx-link-slide">{t("links.slide_label")}</Label>
          <Input
            id="pptx-link-slide"
            type="number"
            min={1}
            max={Math.max(slideCount, 1)}
            value={String(draft.slideIndex + 1)}
            aria-label={t("links.slide_label")}
            className="h-7 max-w-24"
            data-pptx-link-slide
            disabled={blocked}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              setDraft((current) => ({ ...current, slideIndex: Number.isNaN(next) ? -1 : next - 1 }));
            }}
          />
        </div>
      ) : null}

      {draft.mode === "action" ? (
        <div role="radiogroup" aria-label={t("links.action_label")} className="flex flex-wrap gap-1">
          {PPTX_NAMED_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              role="radio"
              aria-checked={draft.action === action}
              aria-label={t(`links.action.${action}`)}
              disabled={blocked}
              data-link-action={action}
              className={cn(
                "rounded-control px-2 py-1 text-caption",
                draft.action === action ? "bg-surface-selected text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setDraft((current) => ({ ...current, action }))}
            >
              {t(`links.action.${action}`)}
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-caption text-muted-foreground" data-pptx-link-current>
        {t(current.key, current.vars)}
      </p>

      {!validation.ok ? (
        <p role="alert" className="text-caption text-destructive" data-pptx-link-invalid>
          {t(validation.reasonKey)}
        </p>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-link-error">
          <AlertTitle>{t("links.error_title")}</AlertTitle>
          <AlertDescription>{t("links.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={blocked || !validation.ok}
          data-pptx-link-apply
          onClick={apply}
        >
          {t("links.apply")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={blocked || !link}
          data-pptx-link-remove
          onClick={remove}
        >
          {t("links.remove")}
        </Button>
        {onClose ? (
          <Button type="button" size="sm" variant="ghost" data-pptx-link-close onClick={onClose}>
            {t("links.close")}
          </Button>
        ) : null}
      </div>

      {inFlight ? (
        <p role="status" className="text-caption text-muted-foreground" data-pptx-link-busy>
          {t("links.busy")}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-link-unbound">
          {blockedReason}
        </p>
      ) : null}

    </section>
  );
}