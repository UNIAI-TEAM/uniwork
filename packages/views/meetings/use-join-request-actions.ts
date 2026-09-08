"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useApproveJoinRequest, useRejectJoinRequest } from "@uniwork/core/meetings";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";

export function useJoinRequestActions(meetingId: string) {
  const { t } = useTranslation();
  const approve = useApproveJoinRequest(meetingId);
  const reject = useRejectJoinRequest(meetingId);

  const approveOne = useCallback(
    (requestId: string, opts?: { silent?: boolean }) => {
      approve.mutate(requestId, {
        onSuccess: () => {
          if (!opts?.silent) toast.success(t("meetings.guestAdmitted"));
        },
        onError: (err) => toastApiError(err, t("common.error")),
      });
    },
    [approve, t],
  );

  const rejectOne = useCallback(
    (requestId: string) => {
      reject.mutate(
        { requestId },
        { onError: (err) => toastApiError(err, t("common.error")) },
      );
    },
    [reject, t],
  );

  const admitAll = useCallback(
    async (pending: MeetingJoinRequest[]) => {
      for (const r of pending) {
        try {
          await approve.mutateAsync(r.id);
        } catch (err) {
          toastApiError(err, t("common.error"));
          break;
        }
      }
      if (pending.length > 1) {
        toast.success(t("meetings.allGuestsAdmitted"));
      } else if (pending.length === 1) {
        toast.success(t("meetings.guestAdmitted"));
      }
    },
    [approve, t],
  );

  return {
    approveOne,
    rejectOne,
    admitAll,
    approving: approve.isPending,
    rejecting: reject.isPending,
  };
}
