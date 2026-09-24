"use client";

import { MailOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import type { ComposeMode } from "./compose-recipients";
import { EmailHubScheduledDetail } from "./email-hub-scheduled-detail";
import { EmailHubThreadDetail } from "./email-hub-thread-detail";
import { EmptyPanel } from "./email-hub-view-parts";
import type { EmailHubFolderKey } from "./email-hub-folder-sidebar";

type MailFolderKey = Exclude<EmailHubFolderKey, "SCHEDULED">;

export type EmailHubViewDetailPanelProps = {
  readingEmail: boolean;
  selectedId: string | null;
  isScheduledFolder: boolean;
  selectedScheduled: EmailHubScheduledSendItem | null;
  accountId: string | null;
  cancelScheduledPending: boolean;
  onClearSelection: () => void;
  onCancelScheduled: () => void;
  detailError: boolean;
  detailLoading: boolean;
  activeThread: EmailHubThread | null;
  mailFolder: MailFolderKey;
  detailData: EmailHubThread | null | undefined;
  readableBody: boolean;
  bodyLoading: boolean;
  bodyLoadFailed: boolean;
  starPending: boolean;
  movePending: boolean;
  markReadPending: boolean;
  downloadPending: boolean;
  snoozePending: boolean;
  openCompose: (mode: ComposeMode, source?: EmailHubThread | null) => void;
  onToggleStar: () => void;
  onMarkUnread: () => void;
  onRestoreInbox: () => void;
  onNotSpam: () => void;
  onArchive: () => void;
  onSpam: () => void;
  onClearSnooze: () => void;
  onSnoozeTomorrow: () => void;
  onSnoozeNextWeek: () => void;
  onTrash: () => void;
  onRefetchDetail: () => void;
  onDownloadAttachment: (att: { id: string; filename?: string }) => void;
};

export function EmailHubViewDetailPanel(props: EmailHubViewDetailPanelProps) {
  const { t } = useTranslation();
  const {
    readingEmail,
    selectedId,
    isScheduledFolder,
    selectedScheduled,
    accountId,
    cancelScheduledPending,
    onClearSelection,
    onCancelScheduled,
    detailError,
    detailLoading,
    activeThread,
    mailFolder,
    detailData,
    readableBody,
    bodyLoading,
    bodyLoadFailed,
    starPending,
    movePending,
    markReadPending,
    downloadPending,
    snoozePending,
    openCompose,
    onToggleStar,
    onMarkUnread,
    onRestoreInbox,
    onNotSpam,
    onArchive,
    onSpam,
    onClearSnooze,
    onSnoozeTomorrow,
    onSnoozeNextWeek,
    onTrash,
    onRefetchDetail,
    onDownloadAttachment,
  } = props;

  return (
    <section
      className={cn(
        "min-w-0 flex-1 bg-background lg:min-h-0",
        readingEmail
          ? "flex h-full w-full min-h-0 flex-1 flex-col overflow-hidden"
          : "hidden min-h-[240px] overflow-y-auto p-3 lg:block lg:p-5",
      )}
    >
      {!selectedId ? (
        <EmptyPanel message={t("email_hub.empty_detail")} icon={MailOpen} />
      ) : isScheduledFolder && selectedScheduled && accountId ? (
        <EmailHubScheduledDetail
          item={selectedScheduled}
          cancelPending={cancelScheduledPending}
          onBack={onClearSelection}
          onCancel={onCancelScheduled}
        />
      ) : detailError && !activeThread ? (
        <EmptyPanel message={t("email_hub.load_error")} />
      ) : !activeThread && detailLoading ? (
        <div className="space-y-4 px-4 py-4 lg:px-6">
          <Skeleton className="h-8 w-2/3 rounded-lg" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : activeThread && accountId && selectedId ? (
        <EmailHubThreadDetail
          activeThread={activeThread}
          browserFolder={mailFolder}
          accountId={accountId}
          selectedId={selectedId}
          detailData={detailData}
          readableBody={readableBody}
          bodyLoading={bodyLoading}
          bodyLoadFailed={bodyLoadFailed}
          isError={detailError}
          starPending={starPending}
          movePending={movePending}
          markReadPending={markReadPending}
          downloadPending={downloadPending}
          onBack={onClearSelection}
          onToggleStar={onToggleStar}
          onReply={() => openCompose("reply", detailData ?? activeThread)}
          onReplyAll={() => openCompose("replyAll", detailData ?? activeThread)}
          onForward={() => openCompose("forward", detailData ?? activeThread)}
          onMarkUnread={onMarkUnread}
          onRestoreInbox={onRestoreInbox}
          onNotSpam={onNotSpam}
          onArchive={onArchive}
          onSpam={onSpam}
          snoozePending={snoozePending}
          onClearSnooze={onClearSnooze}
          onSnoozeTomorrow={onSnoozeTomorrow}
          onSnoozeNextWeek={onSnoozeNextWeek}
          onTrash={onTrash}
          onRefetch={onRefetchDetail}
          onDownloadAttachment={onDownloadAttachment}
        />
      ) : (
        <EmptyPanel message={t("email_hub.load_error")} />
      )}
    </section>
  );
}
