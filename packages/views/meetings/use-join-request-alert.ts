"use client";

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { playJoinRequestChime } from "./join-request-chime";
import { requestDisplayName } from "./meeting-join-request-row";

function joinRequestToastId(requestId: string): string {
  return `meeting-join-request-${requestId}`;
}

/**
 * Tells the host, out loud and on screen, that someone is waiting: one toast
 * per new request (admit it, or open the people tab) and one chime per batch.
 * A toast stays until the host acts or the request stops being pending, so a
 * host looking at a shared screen does not miss it (UNI-860).
 */
export function useJoinRequestAlert({
  pending,
  onApprove,
  onOpenPeople,
}: {
  pending: MeetingJoinRequest[];
  onApprove: (requestId: string) => void;
  onOpenPeople?: () => void;
}) {
  const { t } = useTranslation();
  const shown = useRef<Set<string>>(new Set());
  // Latest callbacks without re-running the effect when a parent re-renders.
  const actions = useRef({ onApprove, onOpenPeople, t });
  actions.current = { onApprove, onOpenPeople, t };

  useEffect(() => {
    const current = new Set(pending.map((r) => r.id));
    for (const id of shown.current) {
      if (!current.has(id)) {
        toast.dismiss(joinRequestToastId(id));
        shown.current.delete(id);
      }
    }
    const fresh = pending.filter((r) => !shown.current.has(r.id));
    if (fresh.length === 0) return;
    const { t: tr } = actions.current;
    for (const request of fresh) {
      shown.current.add(request.id);
      toast(tr("meetings.joinRequestToastTitle", { name: requestDisplayName(request) }), {
        id: joinRequestToastId(request.id),
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
        action: {
          label: tr("meetings.approve"),
          onClick: () => actions.current.onApprove(request.id),
        },
        ...(actions.current.onOpenPeople
          ? {
              cancel: {
                label: tr("meetings.joinRequestToastView"),
                onClick: () => actions.current.onOpenPeople?.(),
              },
            }
          : {}),
      });
    }
    playJoinRequestChime();
  }, [pending]);

  // Leaving the room takes its toasts with it. Forgetting them too lets a
  // remount (StrictMode, rejoin) show the ones still pending again.
  useEffect(() => {
    const ids = shown.current;
    return () => {
      for (const id of ids) toast.dismiss(joinRequestToastId(id));
      ids.clear();
    };
  }, []);
}
