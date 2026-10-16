"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseDocumentAccessError } from "@uniwork/core/api/endpoints/documents";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";

export const BREAK_GLASS_REASON_MIN = 10;
export const BREAK_GLASS_REASON_MAX = 500;

export function hasAdminScope(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as { admin_scope?: unknown }).admin_scope === true;
}

export function getBreakGlassExpiresAt(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as { break_glass_expires_at?: unknown }).break_glass_expires_at;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function formatByteSize(bytes: number | undefined): string | null {
  if (typeof bytes !== "number" || Number.isNaN(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatBreakGlassTime(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale.startsWith("en") ? "en-US" : "vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export interface LockedDocumentMetadata {
  title?: string | null;
  ownerName?: string | null;
  visibility?: "workspace" | "restricted" | string | null;
  updatedAt?: string | null;
  sizeBytes?: number | null;
}

export interface AdminLockedCardProps {
  metadata?: LockedDocumentMetadata;
  canBreakGlass?: boolean;
  expired?: boolean;
  isSubmitting?: boolean;
  submitError?: string | null;
  /** A grant was just made but the document still answers "restricted"; offers a retry. */
  grantPending?: boolean;
  onRetryOpen?: () => void;
  onGrantBreakGlass?: (reason: string) => void | Promise<unknown>;
  /** "Manage access" (access addendum §2.5): the share dialog on the admin summary, shown once it answered. */
  onManageAccess?: () => void;
  onOpenAccessLog?: () => void;
  onArchive?: () => void;
}

/**
 * `DocumentLockedCard variant="admin"` (DOC-05): a 403 document_restricted,
 * where a workspace admin manages access from the metadata-only summary but
 * reads the content only through emergency (break-glass) access.
 */
export function AdminLockedCard({
  metadata,
  canBreakGlass = true,
  expired = false,
  isSubmitting = false,
  submitError = null,
  grantPending = false,
  onRetryOpen,
  onGrantBreakGlass,
  onManageAccess,
  onOpenAccessLog,
  onArchive,
}: AdminLockedCardProps) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const reasonId = useId();

  const trimmed = reason.trim();
  // Count code points like the server counts runes, so an emoji is one
  // character on both sides of the 10 / 500 limits (R21 L6).
  const trimmedCount = Array.from(trimmed).length;
  const tooShort = trimmedCount < BREAK_GLASS_REASON_MIN;
  const tooLong = trimmedCount > BREAK_GLASS_REASON_MAX;
  const showTooShort = (reason.length > 0 || submitAttempted) && tooShort;
  const showTooLong = tooLong;
  const validationMessage = showTooLong
    ? t("documents.breakGlass.reasonTooLong")
    : showTooShort
      ? t("documents.breakGlass.reasonTooShort")
      : null;

  const sizeLabel = formatByteSize(metadata?.sizeBytes ?? undefined);
  const updatedTime = metadata?.updatedAt
    ? formatBreakGlassTime(metadata.updatedAt, i18n.language)
    : null;
  const busy = isSubmitting || localSubmitting;
  const errorBanner = submitError ?? localError;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    setLocalError(null);
    if (tooShort || tooLong || !onGrantBreakGlass || busy) {
      return;
    }
    try {
      setLocalSubmitting(true);
      await onGrantBreakGlass(trimmed);
    } catch (err) {
      const invalid = parseDocumentAccessError(err);
      if (invalid?.kind === "break_glass_reason_invalid") {
        // The server names the bound it enforced: pick the message by which
        // side of it the reason fell on, not always "too short".
        const length = invalid.length ?? trimmedCount;
        setLocalError(
          length > invalid.max
            ? t("documents.breakGlass.reasonTooLong")
            : t("documents.breakGlass.reasonTooShort"),
        );
      } else {
        setLocalError(t("documents.breakGlass.submitFailed"));
      }
    } finally {
      setLocalSubmitting(false);
    }
  }

  return (
    <section
      aria-label={t("documents.breakGlass.lockedTitle")}
      data-testid="document-locked-card"
      className="mx-auto my-8 max-w-xl rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xs"
    >
      {expired ? (
        <div
          role="status"
          data-testid="break-glass-expired-banner"
          className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground"
        >
          {t("documents.breakGlass.expiredBanner")}
        </div>
      ) : null}

      {grantPending ? (
        <div
          role="status"
          data-testid="break-glass-pending-banner"
          className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-foreground"
        >
          <span>{t("documents.breakGlass.grantedPending")}</span>
          {onRetryOpen ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetryOpen}>
              {t("documents.detail.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-title font-semibold text-foreground">
            {t("documents.breakGlass.lockedTitle")}
          </h2>
          <p className="text-body text-muted-foreground">
            {t("documents.breakGlass.lockedBody")}
          </p>
        </div>
      </div>

      <div
        data-testid="document-locked-metadata"
        className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption text-muted-foreground"
      >
        <span className="font-medium text-foreground">
          {metadata?.title?.trim() || t("documents.detail.untitled")}
        </span>
        <Badge variant="outline">{t("documents.share.visibility_restricted")}</Badge>
        {metadata?.ownerName ? (
          <span>{t("documents.breakGlass.ownerLabel", { owner: metadata.ownerName })}</span>
        ) : null}
        {updatedTime ? (
          <span>{t("documents.breakGlass.updatedLabel", { time: updatedTime })}</span>
        ) : null}
        {sizeLabel ? <span>{sizeLabel}</span> : null}
      </div>

      {onManageAccess || onOpenAccessLog || onArchive ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onManageAccess ? (
            <Button type="button" size="sm" variant="outline" onClick={onManageAccess}>
              {t("documents.share.admin_manage_button")}
            </Button>
          ) : null}
          {onOpenAccessLog ? (
            <Button type="button" size="sm" variant="outline" onClick={onOpenAccessLog}>
              {t("documents.actions.access_log")}
            </Button>
          ) : null}
          {onArchive ? (
            <Button type="button" size="sm" variant="outline" onClick={onArchive}>
              {t("documents.actions.archive")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {canBreakGlass ? (
        <form onSubmit={handleSubmit} className="mt-5 space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto px-0 py-0 text-caption font-semibold text-foreground hover:bg-transparent"
              onClick={() => textareaRef.current?.focus()}
            >
              {t("documents.breakGlass.openButton")}
            </Button>
            <span
              data-testid="break-glass-reason-counter"
              className="text-caption text-muted-foreground tabular-nums"
            >
              {t("documents.breakGlass.reasonCounter", { count: trimmedCount })}
            </span>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={reasonId}
              className="block text-caption font-medium text-foreground"
            >
              {t("documents.breakGlass.reasonLabel")}
            </label>
            <p className="text-caption text-muted-foreground">
              {t("documents.breakGlass.reasonHint")}
            </p>
            <Textarea
              ref={textareaRef}
              id={reasonId}
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (localError) setLocalError(null);
              }}
              aria-invalid={Boolean(validationMessage)}
            />
          </div>

          {validationMessage ? (
            <p role="alert" data-testid="break-glass-reason-error" className="text-caption text-destructive">
              {validationMessage}
            </p>
          ) : null}

          {errorBanner ? (
            <p role="alert" className="text-caption text-destructive">
              {errorBanner}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              aria-disabled={busy || tooShort || tooLong}
            >
              {t("documents.breakGlass.confirmButton")}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
