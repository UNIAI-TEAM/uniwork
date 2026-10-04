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
 * `texts` is the deck flattened to the op's match unit (one run per entry); the
 * count comes from the committed `planFindReplace` helper, so the number shown
 * is the number the engine replaces. The panel never reads the deck itself.
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
  planFind,
  replaceAllEdit,
  replaceOneEdit,
  stepHitIndex,
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

  // A new query or a changed deck invalidates the active hit; entering the list
  // at the first match keeps Next/Prev honest without a separate "search" step.
  useEffect(() => {
    setHitIndex(clampHitIndex(PPTX_FIND_UNSET_HIT, plan.hits.length));
  }, [plan]);

  const hitTarget = activeHitTarget(texts, plan, hitIndex);
  const hit = plan.hits[hitIndex];
  const canReplaceOne = !blocked && hitTarget !== null;
  const canReplaceAll = !blocked && plan.replaceCount > 0;

  const run = async (edit: PptxFindReplaceEdit | null): Promise<void> => {
    if (!edit || !onFindReplace || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setErrorMessage(null);
    try {
      await onFindReplace(edit);
      // Replace-one consumes the hit, so the next match slides into its place;
      // the effect above re-clamps against the new plan.
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      onError?.(error);
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };

  const move = (direction: 1 | -1) => {
    setHitIndex((current) => stepHitIndex(current, plan.hits.length, direction));
  };

  const status = query === ""
    ? t("find.hint")
    : plan.total === 0
      ? t("find.no_matches")
      : hit
        ? t("find.hit_position", { current: String(hitIndex + 1), total: String(plan.hits.length) })
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
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose?.();
            } else if (event.key === "Enter") {
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
            onCheckedChange={(checked) => setMatchCase(checked === true)}
          />
          <Label htmlFor="pptx-find-match-case">{t("find.match_case")}</Label>
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("find.previous")}
          disabled={plan.hits.length === 0}
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
          disabled={plan.hits.length === 0}
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
          onClick={() => void run(replaceOneEdit(texts, plan, hitIndex, query, replacement, matchCase))}
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