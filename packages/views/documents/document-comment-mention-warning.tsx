"use client";

import { useTranslation } from "react-i18next";
import type { DocumentCommentMentionWithoutAccess } from "@uniwork/core/types/document";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { K } from "./document-comments-keys";
import { formatMentionList, mentionDisplayName } from "./document-comments-model";
import type { MentionWarnState } from "./use-mention-warning";

// The G8-18 pre-send dialog (EXPERIENCE-G8 S14): one person, several people
// (full list through Intl.ListFormat), a neutral mixed row for people the
// caller cannot share with, and the sharing / failed / partial states.

export function MentionWarningDialog({
  state,
  testId,
  onCancel,
  onShare,
  onSendOnly,
}: {
  state: MentionWarnState | null;
  testId: string;
  onCancel: () => void;
  onShare: (targets: DocumentCommentMentionWithoutAccess[]) => void;
  onSendOnly: () => void;
}) {
  const { t, i18n } = useTranslation();
  const list = (people: readonly DocumentCommentMentionWithoutAccess[]) =>
    formatMentionList(people.map(mentionDisplayName), i18n.language);
  const sharing = state?.phase === "sharing";
  const shareable = state?.targets.filter((m) => m.can_share) ?? [];
  const unshareable = state?.targets.filter((m) => !m.can_share) ?? [];
  const partial = state?.phase === "partial_failure";
  const failedBody = state?.phase === "share_failed" || partial;
  // Guards every button while shares run: aria-disabled keeps it focusable, the action is blocked here.
  const guard = (run: () => void) => () => {
    if (!sharing) run();
  };

  return (
    <AlertDialog
      open={state !== null}
      onOpenChange={(next) => {
        if (!next && !sharing) onCancel();
      }}
    >
      <AlertDialogContent data-testid={`${testId}-mention-warn-dialog`}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(K.collabMentionWarnTitle)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(K.collabMentionWarnBody, { names: state ? list(state.targets) : "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state && shareable.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t(K.collabMentionAskManager, { names: list(state.targets) })}</p>
        ) : null}
        {state && shareable.length > 0 && unshareable.length > 0 ? (
          <p className="text-caption text-muted-foreground">{t(K.collabMentionMixedUnshareable, { unshareable: list(unshareable) })}</p>
        ) : null}
        {state && failedBody ? (
          <p role="alert" data-testid={`${testId}-mention-warn-error`} className="text-caption text-destructive">
            {partial
              ? t(K.collabShareViewPartial, { sharedNames: list(state.shared), failedNames: list(state.failed) })
              : t(K.collabShareViewFailed, { failedNames: list(state.failed) })}
          </p>
        ) : null}
        {/* min-w-0 + flex-wrap: the footer stays inside the card's inner width and three buttons wrap instead of poking out. */}
        <AlertDialogFooter className="min-w-0 sm:flex-wrap">
          <Button type="button" variant="outline" aria-disabled={sharing || undefined} onClick={guard(onCancel)}>
            {t(K.collabCancel)}
          </Button>
          {state && partial ? (
            <>
              <Button type="button" variant="outline" aria-disabled={sharing || undefined} onClick={guard(() => onShare(state.failed))}>
                {t(K.collabRetryShareFor, { failedNames: list(state.failed) })}
              </Button>
              <Button type="button" aria-disabled={sharing || undefined} onClick={guard(onSendOnly)}>
                {t(K.collabSendComment)}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant={shareable.length > 0 ? "outline" : "default"} aria-disabled={sharing || undefined} onClick={guard(onSendOnly)}>
                {t(K.collabSendWithoutNotify)}
              </Button>
              {state && shareable.length > 0 ? (
                <Button
                  type="button"
                  aria-disabled={sharing || undefined}
                  onClick={guard(() => onShare(state.phase === "share_failed" ? state.failed : shareable))}
                >
                  {sharing ? (
                    <>
                      <Spinner className="size-3.5" />
                      {t(K.collabSharingView)}
                    </>
                  ) : state.phase === "share_failed" ? (
                    t(K.collabRetry)
                  ) : (
                    t(K.collabShareViewThenSend)
                  )}
                </Button>
              ) : null}
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
