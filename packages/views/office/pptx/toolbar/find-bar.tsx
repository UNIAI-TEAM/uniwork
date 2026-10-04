"use client";

/**
 * The find entry point the ribbon tab row opens (C6: Find at the far right,
 * Ctrl+F). It is a thin chrome surface: it owns the query text and reports it
 * through `onSearch`, and it stays honest when the editor has no search port
 * bound yet (the replace engine half landed in wave A; the wiring is A6's), so
 * the control is never a dead button that silently does nothing.
 */
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";

export interface PptxFindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  /** Absent when no search port is bound; the bar then explains why. */
  onSearch?: (query: string) => void;
  /** Match count for the current query, when a search port reported one. */
  matchCount?: number | null;
  className?: string;
}

export function PptxFindBar({ query, onQueryChange, onClose, onSearch, matchCount, className }: PptxFindBarProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const unbound = typeof onSearch !== "function";
  return (
    <div
      className={cn("flex min-h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-2", className)}
      data-pptx-find-bar
      role="search"
      aria-label={t("find_label")}
    >
      <Input
        autoFocus
        value={query}
        aria-label={t("find_placeholder")}
        placeholder={t("find_placeholder")}
        className="h-7 max-w-56"
        onChange={(event) => {
          const next = event.target.value;
          onQueryChange(next);
          onSearch?.(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
        }}
      />
      <span className="text-caption text-muted-foreground" data-pptx-find-status>
        {unbound
          ? t("find_unbound")
          : typeof matchCount === "number"
            ? t("find_matches", { value: String(matchCount) })
            : t("find_hint")}
      </span>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("find_close")} onClick={onClose}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
