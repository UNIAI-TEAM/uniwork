"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import type { PdfSearchHit } from "./types";

export interface PdfFindBarProps {
  query: string;
  hits: readonly PdfSearchHit[];
  activeIndex?: number;
  loading?: boolean;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose?: () => void;
  onHitActivate?: (hit: PdfSearchHit) => void;
  className?: string;
}

export function PdfFindBar({ query, hits, activeIndex = 0, loading = false, onQueryChange, onNext, onPrevious, onClose, onHitActivate, className }: PdfFindBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const active = hits[activeIndex] ?? null;
  useEffect(() => {
    if (active) onHitActivate?.(active);
  }, [active, onHitActivate]);
  const count = hits.length;
  const countLabel = loading ? t("office.pdf.search.loading") : t("office.pdf.search.matches", { current: count ? activeIndex + 1 : 0, count });
  return (
    <div className={cn("flex min-h-11 items-center gap-1.5 border border-border bg-background px-2 py-1.5 shadow-sm", className)} role="search" aria-label={t("office.pdf.search.label")}>
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <Input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("office.pdf.search.placeholder")} aria-label={t("office.pdf.search.inputLabel")} className="h-8 min-w-0 max-w-64 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input focus-visible:bg-background" />
      <span className="min-w-16 shrink-0 whitespace-nowrap text-center text-caption tabular-nums text-muted-foreground" aria-live="polite">{countLabel}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.pdf.search.previous")} disabled={!count || loading} onClick={() => { onPrevious(); }}><ChevronUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.pdf.search.next")} disabled={!count || loading} onClick={() => { onNext(); }}><ChevronDown aria-hidden="true" /></Button>
      {onClose ? <Button type="button" variant="ghost" size="icon-sm" aria-label={t("office.pdf.search.close")} onClick={onClose}><X aria-hidden="true" /></Button> : null}
    </div>
  );
}
