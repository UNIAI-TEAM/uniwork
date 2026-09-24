"use client";

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
  setSelectedId: (id: string | null) => void,
) {
  const { t } = useTranslation();
  const cancelMutation = useCancelEmailHubScheduledSend(wsId);
  const retryMutation = useRetryEmailHubScheduledSend(wsId);

  const cancel = (onDone: () => void) => {
    if (!accountId || !item) return;
    const failed = isScheduledSendFailed(item.status);
    cancelMutation.mutate(
      { accountId, scheduledId: item.id },
      {
        onSuccess: () => {
          toast.success(t(failed ? "email_hub.scheduled.dismiss_success" : "email_hub.scheduled.cancel_success"));
          setSelectedId(null);
        },
        onError: (err) => toastApiError(err, t("email_hub.scheduled.cancel_error")),
        onSettled: onDone,
      },
    );
  };

  const retry = () => {
    if (!accountId || !item) return;
    retryMutation.mutate(
      { accountId, scheduledId: item.id },
      {
        onSuccess: () => {
          toast.success(t("email_hub.scheduled.retry_success"));
          setSelectedId(null);
        },
        onError: (err) => toastApiError(err, t("email_hub.scheduled.retry_error")),
      },
    );
  };

  return { cancel, retry, cancelPending: cancelMutation.isPending, retryPending: retryMutation.isPending };
}
