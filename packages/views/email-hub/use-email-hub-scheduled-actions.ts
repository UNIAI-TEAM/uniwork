"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { EmailHubScheduledSendItem } from "@uniwork/core/api/endpoints/email-hub";
import { useCancelEmailHubScheduledSend, useRetryEmailHubScheduledSend } from "@uniwork/core/email-hub/hooks";
import { toastApiError } from "../toast-api-error";
import { isScheduledSendFailed } from "./email-hub-scheduled-status";

/** Cancel (or, for a failed send, discard) and retry the open scheduled send, with their feedback. */
export function useEmailHubScheduledActions(
  wsId: string,
  accountId: string | null,
  item: EmailHubScheduledSendItem | null,
  setSelectedId: Dispatch<SetStateAction<string | null>>,
) {
  const { t } = useTranslation();
  const cancelMutation = useCancelEmailHubScheduledSend(wsId);
  const retryMutation = useRetryEmailHubScheduledSend(wsId);

  // The reader may open another send while a request is in flight: only close
  // the one the request was about.
  const closeIfOpen = (id: string) => setSelectedId((cur) => (cur === id ? null : cur));

  const cancel = (onDone: () => void) => {
    if (!accountId || !item) return;
    const id = item.id;
    const failed = isScheduledSendFailed(item.status);
    cancelMutation.mutate(
      { accountId, scheduledId: id },
      {
        onSuccess: () => {
          toast.success(t(failed ? "email_hub.scheduled.dismiss_success" : "email_hub.scheduled.cancel_success"));
          closeIfOpen(id);
        },
        onError: (err) => toastApiError(err, t("email_hub.scheduled.cancel_error")),
        onSettled: onDone,
      },
    );
  };

  const retry = () => {
    if (!accountId || !item) return;
    const id = item.id;
    retryMutation.mutate(
      { accountId, scheduledId: id },
      {
        onSuccess: () => {
          toast.success(t("email_hub.scheduled.retry_success"));
          closeIfOpen(id);
        },
        onError: (err) => toastApiError(err, t("email_hub.scheduled.retry_error")),
      },
    );
  };

  // Pending belongs to the send it was started for, not to whichever is open now.
  const pendingFor = (m: { isPending: boolean; variables?: { scheduledId: string } }) =>
    m.isPending && m.variables?.scheduledId === item?.id;

  return { cancel, retry, cancelPending: pendingFor(cancelMutation), retryPending: pendingFor(retryMutation) };
}
