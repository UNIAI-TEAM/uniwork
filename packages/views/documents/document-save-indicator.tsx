"use client";

import { useTranslation } from "react-i18next";
import { TriangleAlert, Check, Clock, LoaderCircle } from "lucide-react";
import type { DocumentSaveState } from "@uniwork/core/documents/save-state";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

export interface DocumentSaveIndicatorProps {
  /** The page save machine's snapshot. Omitted for a read-only mount. */
  state?: DocumentSaveState | null;
  /** Assets still uploading: nothing is "saved" until they land. */
  pendingUploads?: number;
  readonly?: boolean;
  onRetry?: () => void;
  onResolveConflict?: () => void;
  className?: string;
  /** Keep the page header compact below sm; the full status stays accessible. */
  compact?: boolean;
  /** The surrounding Notice supplies the live region when the status is moved into a strip. */
  announce?: boolean;
}

const BASE = "flex items-center gap-1.5 text-caption text-muted-foreground";

/** "Da luu 10:32" — the reader's clock, not the server's. */
function savedTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(at);
}

/**
 * The one save-state surface of a document (C-01 §7.3), shared by page and
 * file editors. It never claims a save that has not been proven:
 *
 *  - a clean, never-edited document shows nothing at all;
 *  - a pending asset upload outranks everything — the page is not saved while
 *    an image is still going up;
 *  - "unverifiable" reads as not saved, next to the retry that keeps the draft
 *    and its idempotency key.
 */
export function DocumentSaveIndicator({
  state,
  pendingUploads = 0,
  readonly = false,
  onRetry,
  onResolveConflict,
  className,
  compact = false,
  announce = true,
}: DocumentSaveIndicatorProps) {
  const { t } = useTranslation();
  const statusProps = announce ? { role: "status" as const, "aria-live": "polite" as const } : {};

  if (readonly) {
    return <span className={cn(BASE, className)}>{t("documents.save.readonly")}</span>;
  }
  if (pendingUploads > 0) {
    return (
      <span {...statusProps} className={cn(BASE, className)}>
        <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
        {t("documents.save.asset_uploading")}
      </span>
    );
  }
  if (!state || (state.phase === "idle" && !state.dirty)) return null;

  switch (state.phase) {
    case "saving":
      return (
        <span {...statusProps} className={cn(BASE, className)}>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          {t("documents.save.saving")}
        </span>
      );
    case "saved": {
      const at = savedTime(state.acked?.updated_at);
      const label = t("documents.save.saved_at", { time: at ?? "" }).trim();
      return (
        <span {...statusProps} aria-label={label} title={label} className={cn(BASE, className)}>
          <Check aria-hidden className="size-3.5" />
          {compact ? (
            <>
              <span aria-hidden className="sm:hidden">{t("documents.save.saved_at", { time: "" }).trim()}</span>
              <span className="sr-only sm:not-sr-only">{label}</span>
            </>
          ) : label}
        </span>
      );
    }
    case "conflict":
      return (
        <span {...statusProps} className={cn(BASE, "text-warning", className)}>
          <TriangleAlert aria-hidden className="size-3.5" />
          {t("documents.save.conflict")}
          {onResolveConflict ? (
            <Button type="button" size="sm" variant="outline" onClick={onResolveConflict}>
              {t("documents.save.review_conflict")}
            </Button>
          ) : null}
        </span>
      );
    case "error":
    case "unverifiable":
      return (
        <span {...statusProps} className={cn(BASE, "text-warning", className)}>
          <TriangleAlert aria-hidden className="size-3.5" />
          {state.phase === "unverifiable" ? t("documents.save.unverified") : t("documents.save.error")}
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t("documents.save.retry")}
            </Button>
          ) : null}
        </span>
      );
    case "debouncing":
    case "idle":
    default:
      return (
        <span {...statusProps} className={cn(BASE, className)}>
          <Clock aria-hidden className="size-3.5" />
          {t("documents.save.unsaved")}
        </span>
      );
  }
}
