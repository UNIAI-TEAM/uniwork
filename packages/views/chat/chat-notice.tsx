"use client";

import { AlertCircle, Ban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";

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
          icon={AlertCircle}
          live="off"
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRetryWorkspace}>
              {t("chat.retry")}
            </Button>
          }
        >
          {t("chat.room_load_failed")}
        </Notice>
      ) : null}
      {connectError ? (
        <Notice tone="destructive" icon={AlertCircle} live="assertive">
          {connectError}
        </Notice>
      ) : null}
      {blockedNotice ? (
        <Notice tone="muted" icon={Ban} live="off">
          {blockedNotice}
        </Notice>
      ) : null}
    </>
  );
}
