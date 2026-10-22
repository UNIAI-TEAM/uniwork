"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AiCitation } from "@uniwork/core/types";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@uniwork/ui/components/ui/hover-card";
import { AppLink } from "../navigation";
import { isInAppHref } from "./ask-uni-links";

/**
 * The superscript `[S#]` marker of a cited source. A real button, not an anchor: the
 * marker can sit inside an allowed link. Opens on hover or focus (HoverCard) and on
 * click or tap, so touch and keyboard users reach the quote too.
 */
export function CitationMarker({ citation }: { citation: AiCitation }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const [open, setOpen] = useState(false);
  const n = citation.source_id.replace(/^S/, "");
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <sup className="mx-0.5">
        <HoverCardTrigger
          delay={150}
          render={<button type="button" />}
          aria-label={t("cite.label", { n })}
          onClick={(e) => {
            // The marker can sit inside an allowed link; opening the card must not follow it.
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className="relative inline-flex min-w-4 items-center justify-center rounded-sm bg-surface-selected px-1 text-caption font-medium text-surface-selected-foreground after:absolute after:-inset-1.5"
        >
          {n}
        </HoverCardTrigger>
      </sup>
      <HoverCardContent align="start" className="w-72">
        <div className="flex flex-col gap-1.5">
          <p className="text-body font-medium">{citation.title || citation.kind}</p>
          {citation.quote ? <p className="line-clamp-4 text-caption text-muted-foreground">{citation.quote}</p> : null}
          {isInAppHref(citation.href) ? (
            <AppLink href={citation.href} className="text-caption font-medium text-primary hover:underline">
              {t("cite.open")}
            </AppLink>
          ) : null}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

/** The chip row under an answer: a link per cited source with an in-app address, plain text for one whose address is not. */
export function SourceChips({ citations }: { citations: AiCitation[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const shown = citations.filter((c) => c.href);
  if (shown.length === 0) return null;
  const chip = "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-caption text-foreground";
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("sources")}>
      {shown.map((c) => {
        const body = (
          <>
            <span className="font-mono text-muted-foreground">[{c.source_id}]</span>
            <span className="truncate">{c.title || c.kind}</span>
          </>
        );
        return (
          <li key={c.source_id}>
            {isInAppHref(c.href) ? (
              <AppLink href={c.href} className={`${chip} hover:bg-surface-hover pointer-coarse:min-h-11`}>
                {body}
              </AppLink>
            ) : (
              <span className={chip}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
