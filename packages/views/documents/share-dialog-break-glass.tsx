"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage, errorCode } from "@uniwork/core/api";
import { isBreakGlassRequiredError } from "@uniwork/core/api/endpoints/documents";
import { useRevokeDocumentBreakGlass } from "@uniwork/core/documents/break-glass-queries";
import { shareLevelNotAllowedMax } from "@uniwork/core/documents/errors";
import { isDocumentNotVerifiable } from "@uniwork/core/types/document";
import type { DocumentBreakGlassGrant } from "@uniwork/core/types/document-access";
import { Button } from "@uniwork/ui/components/ui/button";
import { useOptionalWorkspace } from "../layout/workspace-context";
import type { DocumentAdminRef } from "./document-admin-ref";
import { formatBreakGlassTime, hasAdminScope } from "./document-locked-card";

export { hasAdminScope };

/**
 * The workspace the page sits in. Slugs and names come from the context only:
 * outside it they stay empty rather than being rebuilt from ids, so no URL or
 * label ever shows an id (R21 L4).
 */
export function useShareWorkspace(doc: Pick<DocumentAdminRef, "id" | "organization_id" | "visibility">, wsId: string) {
  const ctx = useOptionalWorkspace();
  return (
    ctx?.workspace ?? {
      id: wsId,
      slug: "",
      name: "",
      organization_id: doc.organization_id,
      organization_slug: "",
      organization_name: "",
    }
  );
}

export function shareErrorMessage(err: unknown, t: ReturnType<typeof useTranslation>["t"]): string | undefined {
  if (isBreakGlassRequiredError(err)) {
    return t("documents.breakGlass.selfShareError");
  }
  if (errorCode(err) === "my_folder_locked") {
    return t("documents.errors.my_folder_locked");
  }
  // A share for the document's own workspace above the home row's ceiling
  // (SH-S1 Q-S1) names that ceiling: say it here instead of the server's
  // own sentence, which is outside the reader's language table.
  const max = shareLevelNotAllowedMax(err);
  if (max) {
    return t("documents.errors.level_not_allowed", { max: t(`documents.share.level_${max}`) });
  }
  if (isDocumentNotVerifiable(err)) {
    return undefined;
  }
  return apiErrorMessage(err);
}

export interface ShareDialogBreakGlassSectionProps {
  wsId: string;
  docId: string;
  grants?: DocumentBreakGlassGrant[];
  initialOpen?: boolean;
  /** Null while member pages are still loading; the row then falls back to a neutral label. */
  resolveName: (userId: string) => string | null;
}

export function ShareDialogBreakGlassSection({
  wsId,
  docId,
  grants = [],
  initialOpen = false,
  resolveName,
}: ShareDialogBreakGlassSectionProps) {
  const { t, i18n } = useTranslation();
  const revokeBreakGlass = useRevokeDocumentBreakGlass(wsId, docId);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  if (grants.length === 0 && !initialOpen) return null;

  return (
    <section
      aria-labelledby="share-break-glass-title"
      data-testid="share-break-glass-section"
      className="rounded-lg border border-warning/40 bg-warning/5"
    >
      <div className="flex items-center gap-2 border-b border-warning/30 px-3 py-2">
        <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-warning" />
        <h3 id="share-break-glass-title" className="text-label font-medium text-foreground">
          {t("documents.breakGlass.accessPanelSection")}
        </h3>
      </div>
      {grants.length === 0 ? (
        <p className="px-3 py-2 text-caption text-muted-foreground">
          {t("documents.breakGlass.noActiveGrants")}
        </p>
      ) : null}
      <ul className="divide-y divide-warning/20">
        {grants.map((grant) => {
          const actorDisplay = grant.actor_name || resolveName(grant.actor_id) || t("documents.share.person_unknown");
          const expiryDisplay = formatBreakGlassTime(grant.expires_at, i18n.language);
          return (
            <li
              key={grant.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 flex-1 text-caption text-foreground">
                {t("documents.breakGlass.accessPanelRow", {
                  name: actorDisplay,
                  time: expiryDisplay,
                  reason: grant.reason,
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`${t("documents.breakGlass.revokeButton")} ${actorDisplay}`}
                disabled={revokeBreakGlass.isPending}
                onClick={() => {
                  setRevokeError(null);
                  revokeBreakGlass.mutate(grant.id, {
                    onError: () => setRevokeError(t("documents.breakGlass.revokeFailed")),
                  });
                }}
              >
                {t("documents.breakGlass.revokeButton")}
              </Button>
            </li>
          );
        })}
      </ul>
      {revokeError ? (
        <p role="alert" className="border-t border-warning/20 px-3 py-2 text-caption text-destructive">
          {revokeError}
        </p>
      ) : null}
    </section>
  );
}
