"use client";

/**
 * Find & replace panel (A6ui, UNI-927).
 *
 * The panel the Find trigger opens: a query field, a replace field, the match
 * count for the current query, next/previous hit navigation, Replace (one, on
 * the hit element) and Replace all, plus a Match case toggle.
 *
 * Contract. It owns no session, no transport and no deck; it is driven by one
 * optional async port:
 *
 *   onFindReplace?(edit: PptxFindReplaceEdit): Promise<unknown> | void
 *
 * `onFindReplace` receives exactly the registered `find_replace` engine kind,
 * so the wire round is a one-line binding (`(edit) => handle.edit([edit])`).
 * With no port bound every control is disabled and the panel says why - it never
 * fakes a capability.
 *
 * `texts` is the deck flattened to the op's match unit (one run per entry); a
 * hit is one occurrence inside a run (R3 F-1). The count comes from the
 * committed `planFindReplace` helper, so the number shown is the number the
 * engine replaces. The panel never reads the deck itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Replace, ReplaceAll, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { cn } from "@uniwork/ui/lib/utils";
import {
  PPTX_FIND_UNSET_HIT,
  activeHitTarget,
  clampHitIndex,
  findOccurrences,
  planFind,
  replaceAllEdit,
  replaceOneEdit,
  stepHitIndex,
  type PptxFindHit,
  type PptxFindReplaceEdit,
  type PptxFindTextTarget,
} from "./pptx-find-model";

export interface PptxFindReplacePanelProps {
  /** Deck flattened to one entry per run - the op's match unit. */
  texts: readonly PptxFindTextTarget[];
  /** Seed the query (the ribbon's Find bar keeps its own query). */
  initialQuery?: string;
  /** The engine edit channel. Absent -> every control is disabled with the
   *  "not bound" reason. */
  onFindReplace?: (edit: PptxFindReplaceEdit) => Promise<unknown> | void;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** The run under the active hit changed (null: no hit). The editor moves the
   *  canvas to that slide and selects the element, so the match is visible. */
  onActiveHitChange?: (hit: PptxFindHit | null) => void;
  /** A replace is in flight. */
  busy?: boolean;
  /** Read-only document. */
  readonly?: boolean;
  onClose?: () => void;
  className?: string;
}

export function PptxFindReplacePanel({
  texts,
  initialQuery = "",
  onFindReplace,
  onError,
  onActiveHitChange,
  busy = false,
  readonly = false,
  onClose,
  className,
}: PptxFindReplacePanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [query, setQuery] = useState(initialQuery);
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [hitIndex, setHitIndex] = useState(PPTX_FIND_UNSET_HIT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busyRef = useRef(false);

  const bound = typeof onFindReplace === "function";
  const inFlight = busy || pending;
  const blocked = readonly || !bound || inFlight;

  const plan = useMemo(() => planFind(texts, query, matchCase), [texts, query, matchCase]);
  // R3 F-1: one hit per occurrence, so a run holding the query twice counts 2.
  const hits = useMemo(() => findOccurrences(texts, query, matchCase), [texts, query, matchCase]);

  // After Replace (one) the deck moves and the plan is rebuilt: the occurrence
  // that was replaced dropped out, so the next remaining one sits at the same
  // position (its offset recomputed from the edited run), wrapping past the end.
  const resumeAtRef = useRef<number | null>(null);

  // A new query or a changed deck invalidates the active hit; entering the list
  // at the first match keeps Next/Prev honest without a separate "search" step.
  useEffect(() => {
    const resumeAt = resumeAtRef.current;
    resumeAtRef.current = null;
    const total = hits.length;
    setHitIndex(resumeAt !== null && resumeAt < total ? resumeAt : clampHitIndex(PPTX_FIND_UNSET_HIT, total));
  }, [hits]);

  // X4fix F6: Escape closes from any control in the panel, not only the query.
  const rootRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current?.();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, []);

  // A pending hit intent must not outlive the panel (X4fix F9).
  const onActiveHitChangeRef = useRef(onActiveHitChange);
  useEffect(() => { onActiveHitChangeRef.current = onActiveHitChange; }, [onActiveHitChange]);
  useEffect(() => () => onActiveHitChangeRef.current?.(null), []);

  const hitTarget = activeHitTarget(hits, hitIndex);
  // Reported on the hit's identity (index + slide + element), not on every deck
  // change, so an edit made while the panel is open never re-selects over a
  // canvas click the user made since.
  const hitSlide = hitTarget?.slideIndex;
  const hitElement = hitTarget?.elementId;
  useEffect(() => {
    onActiveHitChange?.(hitSlide === undefined ? null : { slideIndex: hitSlide, ...(hitElement ? { elementId: hitElement } : {}) });
  }, [hitIndex, hitSlide, hitElement, onActiveHitChange]);
  const canReplaceOne = !blocked && hitTarget !== null;
  const canReplaceAll = !blocked && plan.replaceCount > 0;

  const run = async (edit: PptxFindReplaceEdit | null): Promise<void> => {
    if (!edit || !onFindReplace || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setErrorMessage(null);
    try {
      // Replace (one) advances: the plan effect resumes at this position once
      // the edited deck arrives. Replace all starts over at the first hit.
      resumeAtRef.current = edit.occurrence !== undefined || edit.firstOnly === true ? hitIndex : null;
      await onFindReplace(edit);
    } catch (error) {
      resumeAtRef.current = null;
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      onError?.(error);
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };

  const move = (direction: 1 | -1) => {
    setHitIndex((current) => stepHitIndex(current, hits.length, direction));
  };

  const status = query === ""
    ? t("find.hint")
    : plan.total === 0
      ? t("find.no_matches")
      : hitTarget
        ? t("find.hit_position", { current: String(hitIndex + 1), total: String(hits.length) })
        : t("find.matches", { value: String(plan.total) });

  const blockedReason = readonly
    ? t("find.readonly")
    : !bound
      ? t("find.unbound")
      : null;

  return (
    <section
      aria-label={t("find.title")}
      data-pptx-find-replace
      data-state={inFlight ? "busy" : "ready"}
      ref={rootRef}
      className={cn(
        "flex min-h-9 shrink-0 flex-col gap-2 border-b border-border bg-muted/20 px-2 py-2",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={query}
          aria-label={t("find.query_label")}
          placeholder={t("find.query_placeholder")}
          className="h-7 max-w-56"
          data-pptx-find-query
          onChange={(event) => { resumeAtRef.current = null; setQuery(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <Input
          value={replacement}
          aria-label={t("find.replace_label")}
          placeholder={t("find.replace_placeholder")}
          className="h-7 max-w-56"
          data-pptx-find-replace-field
          disabled={readonly}
          onChange={(event) => setReplacement(event.target.value)}
        />
        <span className="text-caption text-muted-foreground" data-pptx-find-count>
          {status}
        </span>
        {hitTarget ? (
          <span className="text-caption text-muted-foreground" data-pptx-find-hit-slide>
            {t("find.hit_slide", { index: String(hitTarget.slideIndex + 1) })}
          </span>
        ) : null}
        <span className="flex items-center gap-2">
          <Checkbox
            id="pptx-find-match-case"
            checked={matchCase}
            disabled={readonly}
            aria-label={t("find.match_case")}
            onCheckedChange={(checked) => { resumeAtRef.current = null; setMatchCase(checked === true); }}
          />
          <Label htmlFor="pptx-find-match-case">{t("find.match_case")}</Label>
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("find.previous")}
          disabled={hits.length === 0}
          data-pptx-find-prev
          onClick={() => move(-1)}
        >
          <ChevronUp aria-hidden />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("find.next")}
          disabled={hits.length === 0}
          data-pptx-find-next
          onClick={() => move(1)}
        >
          <ChevronDown aria-hidden />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canReplaceOne}
          data-pptx-find-replace-one
          onClick={() => void run(replaceOneEdit(hits, hitIndex, query, replacement, matchCase))}
        >
          <Replace aria-hidden />
          {t("find.replace_one")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canReplaceAll}
          data-pptx-find-replace-all
          onClick={() => void run(replaceAllEdit(query, replacement, matchCase))}
        >
          <ReplaceAll aria-hidden />
          {t("find.replace_all")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("find.close")}
          data-pptx-find-close
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>

      {inFlight ? (
        <p role="status" className="text-caption text-muted-foreground" data-pptx-find-busy>
          {t("find.busy")}
        </p>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-find-error">
          <AlertTitle>{t("find.error_title")}</AlertTitle>
          <AlertDescription>{t("find.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-find-unbound">
          {blockedReason}
        </p>
      ) : null}
    </section>
  );
}