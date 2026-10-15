"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, errorCode, request } from "@uniwork/core/api/http";
import { documentKeys } from "@uniwork/core/documents/keys";
import type { DocumentAccess, DocumentPersonAccess } from "@uniwork/core/types";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";

export const BREAK_GLASS_REASON_MIN = 10;
export const BREAK_GLASS_REASON_MAX = 500;

/**
 * Wire shapes from server contract G8-18 / DOC-05
 * (/home/ubuntu/office-g5g6g7/reports/e6-server/contract-g8-18-doc-05.md).
 * Kept local to views so packages/core types never carry `admin_scope` (spec §11).
 */
export interface DocumentBreakGlassGrant {
  id: string;
  document_id: string;
  actor_id: string;
  actor_name: string;
  level: "view";
  reason: string;
  granted_at: string;
  expires_at: string;
}

export interface DocumentAdminSummaryDocument {
  id: string;
  organization_id?: string;
  workspace_id?: string;
  parent_id?: string | null;
  kind?: string;
  title: string;
  icon?: string | null;
  visibility?: "workspace" | "restricted" | string;
  size_bytes?: number;
  archived_at?: string | null;
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DocumentAdminSummary {
  document: DocumentAdminSummaryDocument;
  acl_owner: DocumentPersonAccess | null;
  my_level: string;
  via?: string;
  admin_scope: boolean;
  my_grant: DocumentBreakGlassGrant | null;
}

export type DocumentAccessWithBreakGlass = DocumentAccess & {
  admin_scope?: boolean;
  break_glass?: DocumentBreakGlassGrant[];
};

export interface BreakGlassAdapter {
  getAdminSummary: (wsId: string, documentId: string) => Promise<DocumentAdminSummary>;
  grantBreakGlass: (
    wsId: string,
    documentId: string,
    reason: string,
  ) => Promise<{ grant: DocumentBreakGlassGrant }>;
  revokeBreakGlass: (
    wsId: string,
    documentId: string,
    grantId: string,
  ) => Promise<{ status: string }>;
  getAccessWithBreakGlass: (
    wsId: string,
    documentId: string,
  ) => Promise<DocumentAccessWithBreakGlass>;
}

const defaultBreakGlassAdapter: BreakGlassAdapter = {
  getAdminSummary: (_wsId, documentId) =>
    request<DocumentAdminSummary>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/admin-summary`,
    ),
  grantBreakGlass: (_wsId, documentId, reason) =>
    request<{ grant: DocumentBreakGlassGrant }>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/break-glass`,
      { method: "POST", body: { reason } },
    ),
  revokeBreakGlass: (_wsId, documentId, grantId) =>
    request<{ status: string }>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/break-glass/${encodeURIComponent(grantId)}`,
      { method: "DELETE" },
    ),
  getAccessWithBreakGlass: (_wsId, documentId) =>
    request<DocumentAccessWithBreakGlass>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/shares`,
    ),
};

let currentAdapter: BreakGlassAdapter = { ...defaultBreakGlassAdapter };

export function setBreakGlassAdapterForTests(overrides: Partial<BreakGlassAdapter>): void {
  currentAdapter = { ...currentAdapter, ...overrides };
}

export function resetBreakGlassAdapterForTests(): void {
  currentAdapter = { ...defaultBreakGlassAdapter };
}

export function getBreakGlassAdapter(): BreakGlassAdapter {
  return currentAdapter;
}

export function isDocumentRestrictedError(err: unknown): boolean {
  if (errorCode(err) === "document_restricted") return true;
  if (typeof err === "object" && err !== null) {
    return (err as { code?: unknown }).code === "document_restricted";
  }
  return false;
}

export function canBreakGlassFromError(err: unknown): boolean {
  if (!isDocumentRestrictedError(err)) return false;
  const fields =
    err instanceof ApiError
      ? err.fields
      : (err as { fields?: Record<string, unknown> } | null)?.fields;
  const raw = fields?.can_break_glass;
  return raw === true || raw === "true";
}

export function isBreakGlassRequiredError(err: unknown): boolean {
  if (errorCode(err) === "break_glass_required") return true;
  if (typeof err === "object" && err !== null) {
    return (err as { code?: unknown }).code === "break_glass_required";
  }
  return false;
}

export function isBreakGlassReasonInvalidError(err: unknown): boolean {
  if (errorCode(err) === "break_glass_reason_invalid") return true;
  if (typeof err === "object" && err !== null) {
    return (err as { code?: unknown }).code === "break_glass_reason_invalid";
  }
  return false;
}

export function hasAdminScope(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  return (value as { admin_scope?: unknown }).admin_scope === true;
}

export function getBreakGlassExpiresAt(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = (value as { break_glass_expires_at?: unknown }).break_glass_expires_at;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function useDocumentAdminSummary(wsId: string, documentId: string, enabled = true) {
  return useQuery({
    queryKey: [...documentKeys.detail(wsId, documentId), "admin-summary"] as const,
    queryFn: () => currentAdapter.getAdminSummary(wsId, documentId),
    enabled: Boolean(wsId) && Boolean(documentId) && enabled,
    retry: false,
  });
}

export function useDocumentAccessWithBreakGlass(
  wsId: string,
  documentId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: documentKeys.shares(wsId, documentId),
    queryFn: () => currentAdapter.getAccessWithBreakGlass(wsId, documentId),
    enabled: Boolean(wsId) && Boolean(documentId) && enabled,
  });
}

export function useGrantDocumentBreakGlass(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => currentAdapter.grantBreakGlass(wsId, documentId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) });
      void qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) });
      void qc.invalidateQueries({ queryKey: documentKeys.accessLog(wsId, documentId) });
    },
  });
}

export function useRevokeDocumentBreakGlass(wsId: string, documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => currentAdapter.revokeBreakGlass(wsId, documentId, grantId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: documentKeys.detail(wsId, documentId) });
      void qc.invalidateQueries({ queryKey: documentKeys.shares(wsId, documentId) });
      void qc.invalidateQueries({ queryKey: documentKeys.accessLog(wsId, documentId) });
    },
  });
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

export interface DocumentLockedCardProps {
  variant: "admin" | "member";
  metadata?: LockedDocumentMetadata;
  canBreakGlass?: boolean;
  expired?: boolean;
  isSubmitting?: boolean;
  submitError?: string | null;
  onGrantBreakGlass?: (reason: string) => void | Promise<unknown>;
  onShare?: () => void;
  onOpenAccessLog?: () => void;
  onArchive?: () => void;
}

export function DocumentLockedCard({
  variant,
  metadata,
  canBreakGlass = true,
  expired = false,
  isSubmitting = false,
  submitError = null,
  onGrantBreakGlass,
  onShare,
  onOpenAccessLog,
  onArchive,
}: DocumentLockedCardProps) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const trimmed = reason.trim();
  const trimmedCount = trimmed.length;
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
      if (isBreakGlassReasonInvalidError(err)) {
        setLocalError(t("documents.breakGlass.reasonTooShort"));
      } else {
        setLocalError(t("documents.breakGlass.submitFailed"));
      }
    } finally {
      setLocalSubmitting(false);
    }
  }

  if (variant === "member") {
    return (
      <section
        aria-label={t("documents.breakGlass.memberTitle")}
        data-testid="document-locked-card-member"
        className="mx-auto my-8 max-w-xl rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xs"
      >
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-base font-semibold text-foreground">
              {t("documents.breakGlass.memberTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("documents.breakGlass.memberBody")}
            </p>
          </div>
        </div>
      </section>
    );
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
          className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground"
        >
          {t("documents.breakGlass.expiredBanner")}
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            {t("documents.breakGlass.lockedTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("documents.breakGlass.lockedBody")}
          </p>
        </div>
      </div>

      <div
        data-testid="document-locked-metadata"
        className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
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

      {onShare || onOpenAccessLog || onArchive ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onShare ? (
            <Button type="button" size="sm" variant="outline" onClick={onShare}>
              {t("documents.actions.share")}
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
              className="h-auto px-0 py-0 text-xs font-semibold text-foreground hover:bg-transparent"
              onClick={() => textareaRef.current?.focus()}
            >
              {t("documents.breakGlass.openButton")}
            </Button>
            <span
              data-testid="break-glass-reason-counter"
              className="text-xs text-muted-foreground tabular-nums"
            >
              {t("documents.breakGlass.reasonCounter", { count: trimmedCount })}
            </span>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="break-glass-reason-input"
              className="block text-xs font-medium text-foreground"
            >
              {t("documents.breakGlass.reasonLabel")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("documents.breakGlass.reasonHint")}
            </p>
            <textarea
              ref={textareaRef}
              id="break-glass-reason-input"
              rows={3}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (localError) setLocalError(null);
              }}
              aria-invalid={Boolean(validationMessage)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {validationMessage ? (
            <p role="alert" data-testid="break-glass-reason-error" className="text-xs text-destructive">
              {validationMessage}
            </p>
          ) : null}

          {errorBanner ? (
            <p role="alert" className="text-xs text-destructive">
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

export interface DocumentBreakGlassBannerProps {
  expiresAt?: string | null;
  expired?: boolean;
  isEnding?: boolean;
  error?: string | null;
  onEndAccess?: () => void | Promise<unknown>;
}

export function DocumentBreakGlassBanner({
  expiresAt,
  expired = false,
  isEnding = false,
  error = null,
  onEndAccess,
}: DocumentBreakGlassBannerProps) {
  const { t, i18n } = useTranslation();

  if (expired) {
    return (
      <div
        role="status"
        data-testid="break-glass-expired-banner"
        className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-xs text-foreground"
      >
        {t("documents.breakGlass.expiredBanner")}
      </div>
    );
  }

  const formattedTime = formatBreakGlassTime(expiresAt ?? undefined, i18n.language);

  return (
    <div
      role="status"
      data-testid="break-glass-active-banner"
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs text-foreground"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <span>{t("documents.breakGlass.activeBanner", { time: formattedTime })}</span>
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
        {onEndAccess ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isEnding}
            onClick={() => {
              void onEndAccess();
            }}
          >
            {t("documents.breakGlass.endAccessButton")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
