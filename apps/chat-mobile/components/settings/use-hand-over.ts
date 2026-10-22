// The state of an owner handing the organization over inside Settings › Delete account (delete-account.tsx): the
// active members the server lists (data/queries/org-members.ts), who may take over (lib/owner-transfer.ts), the one
// chosen, and the hand-over itself (data/mutations/account.ts › useTransferOwnership). Off (no request) until the
// sheet names an organization to hand over.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAuthStore } from "@/data/auth/store";
import { useTransferOwnership } from "@/data/mutations/account";
import { activeMembersOptions } from "@/data/queries/org-members";
import type { OwnedOrganization } from "@/lib/account-deletion";
import { transferCandidates, type TransferCandidate } from "@/lib/owner-transfer";

export function useHandOver(organization: OwnedOrganization | null) {
  const selfId = useAuthStore((s) => s.user?.id ?? "");
  const members = useQuery({ ...activeMembersOptions(organization?.slug ?? ""), enabled: organization !== null });
  const candidates = useMemo(() => transferCandidates(members.data ?? [], selfId), [members.data, selfId]);
  const [heir, setHeir] = useState<TransferCandidate | null>(null);
  const transfer = useTransferOwnership().mutateAsync;
  return {
    candidates,
    loading: members.isLoading,
    heir,
    choose: setHeir,
    /** Forgets the choice and reads the list again (someone left, or the list did not load). */
    reload: () => {
      setHeir(null);
      void members.refetch();
    },
    /** Hands the organization to the chosen member with the owner's password; rejects with the server's answer. */
    handOver: (orgSlug: string, toUserId: string, password: string) => transfer({ orgSlug, toUserId, password }),
  };
}
