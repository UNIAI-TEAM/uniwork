"use client";

import { useEffect, useRef } from "react";
import { HandHelping, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

export interface EditRequestPromptProps {
  requesterName: string;
  /** "Save and hand over": saves first, hands over only once the save landed. */
  onAccept: () => void;
  onDecline: () => void;
  /** Close = ignore: the request runs out by itself (15 min). */
  onDismiss: () => void;
  pending?: boolean;
  /** The save before the handover failed: nothing was handed over. */
  saveFailed?: boolean;
  /** Opened from the `?edit_request=` link: take focus so the answer is one key away. */
  focusOnMount?: boolean;
}

/**
 * Someone asks the holder for the document (addendum §9 "Nhận yêu cầu"): a
 * prompt inside the editor, never a modal over the holder's work.
 */
export function EditRequestPrompt({ requesterName, onAccept, onDecline, onDismiss, pending = false, saveFailed = false, focusOnMount = false }: EditRequestPromptProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  const title = t("documents.editLock.incomingTitle", { name: requesterName || t("documents.editLock.lostSomeone") });
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={title}
      data-testid="edit-request-prompt"
      className="mb-6 flex flex-col gap-3 rounded-lg border border-border bg-info-soft px-3 py-3 text-info-soft-foreground sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <HandHelping aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-body font-medium text-pretty">{title}</p>
          {saveFailed ? (
            <p role="alert" className="mt-1 text-caption text-destructive">
              {t("documents.editLock.incomingSaveFailed")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} aria-busy={pending || undefined} onClick={onAccept}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("documents.editLock.incomingAccept")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onDecline}>
          {t("documents.editLock.incomingDecline")}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" disabled={pending} aria-label={t("common.close")} onClick={onDismiss}>
          <X aria-hidden />
        </Button>
      </div>
    </section>
  );
}
