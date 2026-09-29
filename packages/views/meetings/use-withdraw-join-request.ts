"use client";

import { useEffect, useRef } from "react";
import { useCancelJoinRequest } from "@uniwork/core/meetings";

/**
 * A member who leaves the lobby while still waiting takes the knock back:
 * otherwise the host keeps a request (and its notice) for someone who is gone
 * and may admit an empty seat. Runs on unmount only, so admission — which
 * keeps the room mounted — never withdraws anything.
 */
export function useWithdrawJoinRequestOnLeave(meetingId: string, waitingRequestId: string | undefined) {
  const cancel = useCancelJoinRequest(meetingId);
  const latest = useRef({ waitingRequestId, cancel: cancel.mutateAsync });
  latest.current = { waitingRequestId, cancel: cancel.mutateAsync };

  useEffect(
    () => () => {
      const { waitingRequestId: id, cancel: withdraw } = latest.current;
      if (id) void withdraw(id).catch(() => undefined);
    },
    [],
  );
}
