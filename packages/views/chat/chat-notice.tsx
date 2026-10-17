"use client";

import { CircleAlert, Ban, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";

/** The canvas strip: at least 44px, a 18px glyph, body-size text. */
export const CHAT_NOTICE_STRIP = "min-h-11 gap-3 py-1.5 pr-3 [&>svg]:size-4.5";

/** "Thử lại" on a strip: a white pill on the tinted band, the band's ink. */
export function ChatNoticeRetryButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8.5 gap-1.5 rounded-full border-current/25 bg-surface pr-3.5 pl-3 font-semibold text-current hover:text-current"
      onClick={onClick}
    >
      <RefreshCw aria-hidden />
      {t("chat.retry")}
    </Button>
  );
}

/**
 * The strips a conversation can carry above its messages, in order of weight.
 * The polite ones are announced through one region that stays mounted and only
 * changes its text — a region mounted together with its text is often missed.
 * A connect error is an alert, which screen readers do read on insertion.
 */
export function ChatConversationNotices({
  workspaceLoadFailed,
  onRetryWorkspace,
  connectError,
  blockedNotice,
}: {
  workspaceLoadFailed: boolean;
  onRetryWorkspace: () => void;
  connectError: string | null;
  blockedNotice: string | null;
}) {
  const { t } = useTranslation();
  const politeText = workspaceLoadFailed ? t("chat.room_load_failed") : (blockedNotice ?? "");
  return (
    <>
      <p role="status" className="sr-only">
        {politeText}
      </p>
      {workspaceLoadFailed ? (
        <Notice
          tone="destructive"
          icon={CircleAlert}
          live="off"
          className={CHAT_NOTICE_STRIP}
          action={<ChatNoticeRetryButton onClick={onRetryWorkspace} />}
        >
          <p className="text-body font-semibold">{t("chat.room_load_failed")}</p>
        </Notice>
      ) : null}
      {connectError ? (
        <Notice tone="destructive" icon={CircleAlert} live="assertive" className="min-h-10 py-1.5">
          <p className="text-label">{connectError}</p>
        </Notice>
      ) : null}
      {blockedNotice ? (
        <Notice tone="muted" icon={Ban} live="off" className={CHAT_NOTICE_STRIP}>
          <p className="text-body font-normal">{blockedNotice}</p>
        </Notice>
      ) : null}
    </>
  );
}
