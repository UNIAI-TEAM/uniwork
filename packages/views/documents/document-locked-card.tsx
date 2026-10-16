"use client";

import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  canBreakGlassFromError,
  isBreakGlassReasonInvalidError,
  isBreakGlassRequiredError,
  isDocumentRestrictedError,
  parseDocumentAccessError,
} from "@uniwork/core/api/endpoints/documents";
import type {
  BreakGlassReasonInvalidError,
  BreakGlassRequiredError,
  DocumentAccessError,
  DocumentAdminSummary,
  DocumentAdminSummaryDocument,
  DocumentBreakGlassGrant,
  DocumentRestrictedError,
} from "@uniwork/core/types/document-access";
import { Button } from "@uniwork/ui/components/ui/button";
import { AdminLockedCard, formatBreakGlassTime, type AdminLockedCardProps } from "./document-locked-card-admin";
import { MemberLockedCard, type MemberLockedCardProps } from "./document-locked-card-member";

export {
  canBreakGlassFromError,
  isBreakGlassReasonInvalidError,
  isBreakGlassRequiredError,
  isDocumentRestrictedError,
  parseDocumentAccessError,
  type BreakGlassReasonInvalidError,
  type BreakGlassRequiredError,
  type DocumentAccessError,
  type DocumentAdminSummary,
  type DocumentAdminSummaryDocument,
  type DocumentBreakGlassGrant,
  type DocumentRestrictedError,
};
export {
  BREAK_GLASS_REASON_MAX,
  BREAK_GLASS_REASON_MIN,
  formatBreakGlassTime,
  getBreakGlassExpiresAt,
  hasAdminScope,
  type LockedDocumentMetadata,
} from "./document-locked-card-admin";
export type { DocumentAccessRequestSource } from "./document-locked-card-member";

export type DocumentLockedCardProps =
  | ({ variant: "member" } & MemberLockedCardProps)
  | ({ variant: "admin" } & AdminLockedCardProps);

/**
 * The screen a signed-in person sees instead of a document they cannot open
 * (permission-levels addendum §4, one component with two variants).
 * `member` (DOC-07): a 404 with a way to ask the managers for access.
 * `admin` (DOC-05): a 403 document_restricted, where an admin manages access
 * and reads the content only through emergency access. Neither variant shows
 * the document's content.
 */
export function DocumentLockedCard(props: DocumentLockedCardProps) {
  return props.variant === "member" ? <MemberLockedCard {...props} /> : <AdminLockedCard {...props} />;
}

export interface DocumentBreakGlassBannerProps {
  expiresAt?: string | null;
  expired?: boolean;
  isEnding?: boolean;
  /** True while the grant id is still unknown (summary loading): End access waits for it. */
  endDisabled?: boolean;
  error?: string | null;
  onEndAccess?: () => void | Promise<unknown>;
}

export function DocumentBreakGlassBanner({
  expiresAt,
  expired = false,
  isEnding = false,
  endDisabled = false,
  error = null,
  onEndAccess,
}: DocumentBreakGlassBannerProps) {
  const { t, i18n } = useTranslation();

  if (expired) {
    return (
      <div
        role="status"
        data-testid="break-glass-expired-banner"
        className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-caption text-foreground"
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
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-caption text-foreground"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 shrink-0 text-warning" aria-hidden />
        <span>{t("documents.breakGlass.activeBanner", { time: formattedTime })}</span>
      </div>
      <div className="flex items-center gap-2">
        {error ? (
          <span role="alert" className="text-caption text-destructive">
            {error}
          </span>
        ) : null}
        {onEndAccess ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isEnding || endDisabled}
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
