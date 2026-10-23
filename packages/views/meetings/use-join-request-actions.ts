"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApproveJoinRequest, useRejectJoinRequest } from "@uniwork/core/meetings";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { toast } from "sonner";
import { toastApiError } from "../toast-api-error";

/** Ids with a request in flight: one row's click must not freeze every other row. */
function usePendingIds() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const add = useCallback((id: string) => setIds((prev) => new Set(prev).add(id)), []);
  const remove = useCallback(
    (id: string) =>
      setIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  return useMemo(() => ({ ids, add, remove }), [ids, add, remove]);
}

export function useJoinRequestActions(meetingId: string) {
  const { t } = useTranslation();
  const approve = useApproveJoinRequest(meetingId);
  const reject = useRejectJoinRequest(meetingId);
  const approvingIds = usePendingIds();
  const rejectingIds = usePendingIds();

  // mutateAsync, not mutate: mutate()'s per-call callbacks fire only for the
  // latest call on a shared observer, so a second row clicked mid-flight would
  // leave the first row's id pending forever and swallow its error.
  const approveOne = useCallback(
    (requestId: string, opts?: { silent?: boolean }) => {
      approvingIds.add(requestId);
      approve
        .mutateAsync(requestId)
        .then(() => {
          if (!opts?.silent) toast.success(t("meetings.guestAdmitted"));
        })
        .catch((err: unknown) => toastApiError(err, t("common.error")))
        .finally(() => approvingIds.remove(requestId));
    },
    [approve, approvingIds, t],
  );

  const rejectOne = useCallback(
    (requestId: string) => {
      rejectingIds.add(requestId);
      reject
        .mutateAsync({ requestId })
        .catch((err: unknown) => toastApiError(err, t("common.error")))
        .finally(() => rejectingIds.remove(requestId));
    },
    [reject, rejectingIds, t],
  );

  const admitAll = useCallback(
    async (pending: MeetingJoinRequest[]) => {
      for (const r of pending) {
        approvingIds.add(r.id);
        try {
          await approve.mutateAsync(r.id);
        } catch (err) {
          toastApiError(err, t("common.error"));
          return;
        } finally {
          approvingIds.remove(r.id);
        }
      }
      if (pending.length > 1) {
        toast.success(t("meetings.allGuestsAdmitted"));
      } else if (pending.length === 1) {
        toast.success(t("meetings.guestAdmitted"));
      }
    },
    [approve, approvingIds, t],
  );

  return {
    approveOne,
    rejectOne,
    admitAll,
    /** Any approval in flight (the bulk "admit all" action). */
    approving: approve.isPending,
    rejecting: reject.isPending,
    isApproving: (requestId: string) => approvingIds.ids.has(requestId),
    isRejecting: (requestId: string) => rejectingIds.ids.has(requestId),
  };
}
