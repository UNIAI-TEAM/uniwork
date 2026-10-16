"use client";

import type { ReactNode } from "react";
import { AppWindow, CircleAlert, CircleCheck, Clock, CloudOff, Pencil, Send, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice, type NoticeTone } from "../common/notice";
import { formatLockTime, lostCopyKey } from "./edit-lock-copy";
import type { EditLockBannerView } from "./edit-lock-view-model";

export interface DocumentEditLockBannerProps {
  view: EditLockBannerView;
  onTakeOver: () => void;
  onRequest: () => void;
  onCancelRequest: (requestId: string) => void;
  onEditHere: () => void;
  onEditNow: () => void;
  /** An action of this banner is in flight: its buttons wait. */
  pending?: boolean;
}

/**
 * Why a document someone may edit is read-only right now, and the way on
 * (addendum §11.3): someone else is editing (take over / request), the same
 * person in another window (edit here), nobody any more (edit now), or the
 * request this user sent. One persistent polite status region holds the
 * sentence as text only (it changes, so each state is read once; a region
 * mounted with its text is not reliably announced). The visible strip repeats
 * it for sighted users, hidden from the accessibility tree, and the buttons
 * sit outside the region so they are never re-read and keep focus.
 */
export function DocumentEditLockBanner({ view, onTakeOver, onRequest, onCancelRequest, onEditHere, onEditNow, pending = false }: DocumentEditLockBannerProps) {
  const { t, i18n } = useTranslation();
  const time = (iso: string | null | undefined) => formatLockTime(iso, i18n.language);
  const action = (label: string, run: () => void, variant: "default" | "outline" = "outline") => (
    <Button key={label} type="button" size="sm" variant={variant} aria-disabled={pending || undefined} aria-busy={pending || undefined} onClick={run}>
      {label}
    </Button>
  );

  let body: ReactNode = null;
  // The sentences, each on its own line in the strip (V-6); the status region reads them joined.
  let lines: string[] = [];
  let actions: ReactNode[] = [];
  let icon = Pencil;
  let tone: NoticeTone = "info";
  switch (view.kind) {
    case "none":
      break;
    case "error":
      icon = CircleAlert;
      tone = "warning";
      body = t("documents.editLock.acquireFailed");
      break;
    case "unheld":
      icon = CircleCheck;
      tone = "success";
      body = t("documents.editLock.bannerFree");
      actions = [action(t("documents.editLock.editNow"), onEditNow, "default")];
      break;
    case "selfElsewhere":
      icon = AppWindow;
      body = t("documents.editLock.bannerSelfElsewhere");
      actions = [action(t("documents.editLock.editHere"), onEditHere, "default")];
      break;
    case "other": {
      const name = view.holderName || t("documents.editLock.lostSomeone");
      let sentences: string[];
      if (view.rateLimitedMinutes !== null) {
        sentences = [t("documents.editLock.requestRateLimited", { minutes: view.rateLimitedMinutes })];
        tone = "muted";
        icon = Clock;
      } else if (view.request?.state === "pending") {
        sentences = [t("documents.editLock.requestSent", { name, time: time(view.request.expiresAt) })];
        icon = Send;
        const requestId = view.request.requestId;
        actions.push(action(t("documents.editLock.requestCancel"), () => onCancelRequest(requestId)));
      } else if (view.request?.state === "notReleased") {
        sentences = [t("documents.editLock.requestNotReleased", { name })];
        tone = "muted";
        icon = Clock;
      } else {
        sentences = [
          view.offlineHoldUntil
            ? t("documents.editLock.bannerOfflineHold", { name, time: time(view.offlineHoldUntil) })
            : t("documents.editLock.bannerOther", { name, time: time(view.since) }),
        ];
        icon = view.offlineHoldUntil ? CloudOff : Pencil;
      }
      if (view.canTakeOver) actions.push(action(t("documents.editLock.takeOver"), onTakeOver, "default"));
      else if (view.canRequest && view.request?.state !== "pending" && view.rateLimitedMinutes === null) {
        const label = view.request?.state === "notReleased" ? t("documents.editLock.requestAgain") : t("documents.editLock.request");
        actions.push(action(label, onRequest));
      }
      lines = sentences;
      body = sentences.join(" ");
      break;
    }
    default:
      break;
  }
  if (body !== null && view.kind !== "none" && view.kind !== "error" && view.lost) {
    tone = "warning";
    icon = TriangleAlert;
    lines = [t(lostCopyKey(view.lost.reason), { name: view.lost.byName || t("documents.editLock.lostSomeone") }), ...(lines.length ? lines : [String(body)])];
    body = lines.join(" ");
  }

  return (
    <div data-testid="edit-lock-banner" data-state={view.kind}>
      <div role="status" aria-live="polite" className="sr-only" data-testid="edit-lock-banner-status">
        {body}
      </div>
      {body !== null ? (
        <Notice tone={tone} icon={icon} live="off" action={actions.length ? <div className="flex flex-wrap gap-2">{actions}</div> : undefined}>
          <span aria-hidden="true">
            {(lines.length ? lines : [String(body)]).map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
          </span>
        </Notice>
      ) : null}
    </div>
  );
}
