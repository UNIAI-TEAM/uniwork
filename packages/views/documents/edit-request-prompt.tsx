"use client";

import { useEffect, useRef, useState } from "react";
import { HandHelping, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { relativeTime } from "../notifications/relative-time";

export interface EditRequestPromptProps {
  requesterName: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  /** "Save and hand over": saves first, hands over only once the save landed. */
  onAccept: () => void;
  onDecline: () => void;
  /** Close = ignore: the request runs out by itself. */
  onDismiss: () => void;
  pending?: boolean;
  /** The save before the handover failed: nothing was handed over. */
  saveFailed?: boolean;
  /** Opened from the `?edit_request=` link: take focus so the answer is one key away. */
  focusOnMount?: boolean;
}

const MINUTE_MS = 60_000;
const FALLBACK_SPAN_MS = 15 * MINUTE_MS;

function requestCaption(
  createdAt: string | null | undefined,
  expiresAt: string | null | undefined,
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (!expiresAt) return null;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return null;
  const nowMs = Date.now();
  const minutes = Math.max(1, Math.ceil((expiresMs - nowMs) / MINUTE_MS));
  const parsedCreated = createdAt ? Date.parse(createdAt) : Number.NaN;
  const originMs = Number.isFinite(parsedCreated) ? parsedCreated : expiresMs - FALLBACK_SPAN_MS;
  if (nowMs - originMs < MINUTE_MS) {
    return t("documents.editLock.incomingCaption", { minutes });
  }
  const age = relativeTime(new Date(originMs).toISOString(), locale, new Date(nowMs)) || t("documents.editLock.incomingJustNow");
  return t("documents.editLock.incomingCaptionAged", { age, minutes });
}

/**
 * Someone asks the holder for the document (addendum §9 "Nhận yêu cầu"): a
 * prompt inside the editor, never a modal over the holder's work.
 */
export function EditRequestPrompt({
  requesterName,
  createdAt,
  expiresAt,
  onAccept,
  onDecline,
  onDismiss,
  pending = false,
  saveFailed = false,
  focusOnMount = false,
}: EditRequestPromptProps) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  const title = t("documents.editLock.incomingTitle", { name: requesterName || t("documents.editLock.lostSomeone") });
  const caption = requestCaption(createdAt, expiresAt, i18n.language, t);
  // A live region mounted together with its text is not reliably announced: the region exists first,
  // the sentence goes in on the next commit. The buttons stay outside it (a status region is re-read whole).
  const [announced, setAnnounced] = useState("");
  useEffect(() => setAnnounced(title), [title]);
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
          {caption ? <p className="text-caption text-muted-foreground">{caption}</p> : null}
          <p role="status" aria-live="polite" className="sr-only">
            {announced}
          </p>
          {saveFailed ? (
            <p role="alert" className="mt-1 text-caption text-destructive">
              {t("documents.editLock.incomingSaveFailed")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={onAccept}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {t("documents.editLock.incomingAccept")}
        </Button>
        <Button type="button" size="sm" variant="outline" aria-disabled={pending || undefined} onClick={onDecline}>
          {t("documents.editLock.incomingDecline")}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-disabled={pending || undefined} aria-label={t("common.close")} onClick={onDismiss}>
          <X aria-hidden />
        </Button>
      </div>
    </section>
  );
}
