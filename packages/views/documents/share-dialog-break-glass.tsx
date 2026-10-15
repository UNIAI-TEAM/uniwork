"use client";

import { ShieldAlert } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import type { Document } from "@uniwork/core/types/document";
import { Button } from "@uniwork/ui/components/ui/button";
import { useOptionalWorkspace } from "../layout/workspace-context";
import {
  formatBreakGlassTime,
  hasAdminScope,
  isBreakGlassRequiredError,
  useDocumentAccessWithBreakGlass,
  useRevokeDocumentBreakGlass,
  type DocumentBreakGlassGrant,
} from "./document-locked-card";

export { hasAdminScope };

export function useShareWorkspace(doc: Document, wsId: string) {
  const ctx = useOptionalWorkspace();
  return (
    ctx?.workspace ?? {
      id: wsId,
      slug: wsId,
      organization_id: doc.organization_id,
      organization_slug: doc.organization_id,
      organization_name: doc.organization_id,
    }
  );
}

export function useShareAccessQuery(
  wsId: string,
  docId: string,
  opts: { enabled: boolean },
) {
  return useDocumentAccessWithBreakGlass(wsId, docId, opts.enabled);
}

export function shareErrorMessage(err: unknown, t: TFunction): string | undefined {
  if (isBreakGlassRequiredError(err)) {
    return t("documents.breakGlass.selfShareError");
  }
  return apiErrorMessage(err);
}

export interface ShareDialogBreakGlassSectionProps {
  wsId: string;
  docId: string;
  grants?: DocumentBreakGlassGrant[];
  initialOpen?: boolean;
  resolveName: (userId: string) => string;
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
      <ul className="divide-y divide-warning/20">
        {grants.map((grant) => {
          const actorDisplay = grant.actor_name || resolveName(grant.actor_id);
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
                  revokeBreakGlass.mutate(grant.id);
                }}
              >
                {t("documents.breakGlass.revokeButton")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
