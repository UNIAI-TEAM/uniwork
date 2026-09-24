"use client";

import { ArrowLeft, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import type { EmailHubMailFolderKey } from "./email-hub-folders";
import { EmailHubScheduledDetail } from "./email-hub-scheduled-detail";
import { EmailHubThreadDetail } from "./email-hub-thread-detail";
import type { EmailHubThreadActions, EmailHubThreadPending } from "./email-hub-thread-toolbar";
import { EmailHubEmptyState } from "./email-hub-view-parts";

export type EmailHubViewDetailPanelProps = {
  isScheduledFolder: boolean;
  selectedScheduled: EmailHubScheduledSendItem | null;
  cancelScheduledPending: boolean;
  onCancelScheduled: (onDone: () => void) => void;
  retryScheduledPending: boolean;
  onRetryScheduled: () => void;
  detailError: boolean;
  detailLoading: boolean;
  activeThread: EmailHubThread | null;
  mailFolder: EmailHubMailFolderKey;
  detailData: EmailHubThread | null | undefined;
  readableBody: boolean;
  bodyLoading: boolean;
  bodyLoadFailed: boolean;
  actions: EmailHubThreadActions;
  pending: EmailHubThreadPending;
  aiOpen: boolean;
};

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 pt-5 lg:px-8" aria-busy="true">
      <Skeleton className="h-7 w-2/3" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

/** The reading pane: one email or one scheduled send. Shown instead of the list, never beside an empty one. */
export function EmailHubViewDetailPanel(props: EmailHubViewDetailPanelProps) {
  const { t } = useTranslation();
  const { actions } = props;

  let content;
  if (props.isScheduledFolder) {
    content = props.selectedScheduled ? (
      <EmailHubScheduledDetail
        item={props.selectedScheduled}
        cancelPending={props.cancelScheduledPending}
        retryPending={props.retryScheduledPending}
        onBack={actions.onBack}
        onCancel={props.onCancelScheduled}
        onRetry={props.onRetryScheduled}
      />
    ) : null;
  } else if (props.activeThread) {
    content = (
      <EmailHubThreadDetail
        activeThread={props.activeThread}
        browserFolder={props.mailFolder}
        detailData={props.detailData}
        readableBody={props.readableBody}
        bodyLoading={props.bodyLoading}
        bodyLoadFailed={props.bodyLoadFailed}
        isError={props.detailError}
        actions={actions}
        pending={props.pending}
        aiOpen={props.aiOpen}
      />
    );
  } else if (props.detailLoading) {
    content = <DetailSkeleton />;
  } else {
    content = (
      <EmailHubEmptyState
        icon={TriangleAlert}
        message={t("email_hub.load_error")}
        action={
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={actions.onBack}>
              <ArrowLeft aria-hidden />
              {t("email_hub.back_to_list")}
            </Button>
            <Button type="button" variant="outline" onClick={actions.onRefetch}>
              <RefreshCw aria-hidden />
              {t("common.retry")}
            </Button>
          </div>
        }
      />
    );
  }

  return <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">{content}</section>;
}
