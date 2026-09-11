"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode } from "@uniwork/core/api";

/** The organization itself is closed: a platform admin suspended it (F-11). */
export const ORGANIZATION_SUSPENDED = "organization_suspended";
/** The organization is open, but this person has been switched off (F-03). */
export const MEMBER_DEACTIVATED = "member_deactivated";

/** Which of the two blocks is in force, or null while neither is. */
export type OrganizationBlock = typeof ORGANIZATION_SUSPENDED | typeof MEMBER_DEACTIVATED | null;

const BLOCKS: readonly string[] = [ORGANIZATION_SUSPENDED, MEMBER_DEACTIVATED];

/**
 * The first error in this client that means "you cannot be in here". The
 * server refuses every organization and workspace route in both cases, so one
 * such error is the whole story and the shell swaps the page for the notice.
 *
 * The two are kept apart because they say different things to the person
 * reading them: the company is paused, or your own account in it is.
 */
// ponytail: latches until the shell remounts; either state is rare and a reload away.
export function useOrganizationBlock(): OrganizationBlock {
  const qc = useQueryClient();
  const [block, setBlock] = useState<OrganizationBlock>(null);
  useEffect(() => {
    const record = (err: unknown) => {
      const code = errorCode(err);
      if (code && BLOCKS.includes(code)) setBlock(code as OrganizationBlock);
    };
    const unQuery = qc.getQueryCache().subscribe((e) => {
      if (e.type === "updated") record(e.query.state.error);
    });
    const unMutation = qc.getMutationCache().subscribe((e) => {
      if (e.type === "updated") record(e.mutation.state.error);
    });
    return () => {
      unQuery();
      unMutation();
    };
  }, [qc]);
  return block;
}
