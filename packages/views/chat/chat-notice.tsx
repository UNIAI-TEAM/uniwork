"use client";

import { AlertCircle, Ban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";

/** The strips a conversation can carry above its messages, in order of weight. */
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
  return (
    <>
      {workspaceLoadFailed ? (
        <Notice
          tone="destructive"
          icon={AlertCircle}
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
        <Notice tone="muted" icon={Ban}>
          {blockedNotice}
        </Notice>
      ) : null}
    </>
  );
}
