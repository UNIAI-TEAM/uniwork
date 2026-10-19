"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useShareDocument } from "@uniwork/core/documents/hooks-sharing";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { K } from "./document-comments-keys";
import { formatMentionList } from "./document-comments-model";
import type { BodyMentionTarget } from "./use-body-mention-hint";

/**
 * The inline no-access hint for body mentions (UNI-1968 W2): after an
 * acknowledged save, the people `targets` names never got the
 * `document_body_mentioned` row because they cannot view the page. The share
 * action grants view to everyone listed and closes once each one went
 * through; a dismissed hint stays gone until the mentions change. A reader
 * who cannot administer shares nothing and is told to ask a manager —
 * mirroring the pre-send mention warning.
 */
export function BodyMentionNotice({
  wsId,
  documentId,
  documentWorkspaceId = "",
  targets,
  /** True when the viewer may share (`canAdministerDocument` or the owner). */
  canAdminister,
  onDismiss,
  /** Replaces the share transport call (`POST /api/v1/documents/{id}/shares`). */
  onShareView,
  /** Called after every share attempt so the hint can refetch candidates. */
  onShared,
  testId = "document-body-mention-notice",
}: {
  wsId: string;
  documentId: string;
  documentWorkspaceId?: string;
  targets: readonly BodyMentionTarget[];
  canAdminister: boolean;
  onDismiss: () => void;
  onShareView?: (userId: string) => Promise<void>;
  onShared?: () => Promise<void> | void;
  testId?: string;
}) {
  const { t, i18n } = useTranslation();
  const shareMutation = useShareDocument(wsId, documentId, documentWorkspaceId);
  const [sharing, setSharing] = useState(false);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());

  if (targets.length === 0) return null;

  const names = formatMentionList(
    targets.map((target) => target.display_name || target.user_id),
    i18n.language,
  );
  const failed = targets.filter((target) => failedIds.has(target.user_id.toUpperCase()));

  const shareAll = async () => {
    if (sharing) return;
    setSharing(true);
    const failedNow = new Set<string>();
    for (const target of targets) {
      try {
        if (onShareView) await onShareView(target.user_id);
        else await shareMutation.mutateAsync({ principal_type: "user", principal_id: target.user_id, level: "view" });
      } catch {
        failedNow.add(target.user_id.toUpperCase());
      }
    }
    setFailedIds(failedNow);
    setSharing(false);
    await onShared?.();
    if (failedNow.size === 0) onDismiss();
  };

  return (
    <div
      role="status"
      data-testid={testId}
      className="mx-auto mt-2 flex w-full max-w-3xl items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-caption text-foreground"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <p>{t(K.collabBodyMentionNoAccess, { names })}</p>
        {canAdminister ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            aria-disabled={sharing || undefined}
            onClick={() => void shareAll()}
            data-testid={`${testId}-share`}
          >
            {sharing ? (
              <>
                <Spinner className="size-3" />
                {t(K.collabSharingView)}
              </>
            ) : failed.length > 0 ? (
              t(K.collabRetryShareFor, {
                failedNames: formatMentionList(
                  failed.map((target) => target.display_name || target.user_id),
                  i18n.language,
                ),
              })
            ) : (
              t(K.collabPostSendShareAction)
            )}
          </Button>
        ) : (
          <p className="text-micro text-muted-foreground">{t(K.collabMentionAskManager, { names })}</p>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        aria-label={t("common.close")}
        onClick={onDismiss}
        data-testid={`${testId}-dismiss`}
      >
        <X aria-hidden />
      </Button>
    </div>
  );
}
