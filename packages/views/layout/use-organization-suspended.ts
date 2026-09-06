"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode } from "@uniwork/core/api";

export const ORGANIZATION_SUSPENDED = "organization_suspended";

/**
 * True once any query or mutation in this client failed with
 * `organization_suspended`: the server refuses every org/workspace route of
 * a suspended organization, so the first such error is the whole story and
 * the shell swaps the page for the notice.
 */
// ponytail: latches until the shell remounts; an unsuspend is rare and a reload away.
export function useOrganizationSuspended(): boolean {
  const qc = useQueryClient();
  const [suspended, setSuspended] = useState(false);
  useEffect(() => {
    const unQuery = qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated" && errorCode(e.query.state.error) === ORGANIZATION_SUSPENDED) setSuspended(true);
    });
    const unMutation = qc.getMutationCache().subscribe((e) => {
      if (e.type === "updated" && errorCode(e.mutation.state.error) === ORGANIZATION_SUSPENDED) setSuspended(true);
    });
    return () => {
      unQuery();
      unMutation();
    };
  }, [qc]);
  return suspended;
}
