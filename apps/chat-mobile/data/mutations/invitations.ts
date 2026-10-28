// Joining through an invitation on the phone (spec §5.2): from the empty workspace picker's list, or from the
// preview a link opened. See command.ts for the layer's rule. The refusals the screens turn into words
// (lib/invitations.ts › inviteRefusal) are not reported as drift.
import { INVITE_HANDLED_CODES } from "@/lib/invitations";
import { invitationsApi, type Accepted } from "../invitations/api";
import { invitationKeys } from "../queries/invitations";
import { workspaceKeys } from "../queries/workspaces";
import { useCommand } from "./command";

/**
 * Joins; resolves where the person landed (null when the answer drifted: they did join). The workspace list is read
 * again before it resolves, so the workspace's own layout finds the one just joined instead of sending the person
 * back to the picker; the list of invitations is read again behind it (not the joined one's preview, which would
 * now read as used).
 */
export const useAcceptInvitation = () =>
  useCommand(
    "invitations.accept",
    async (qc, token: string): Promise<Accepted | null> => {
      const accepted = await invitationsApi.accept(token);
      await qc.refetchQueries({ queryKey: workspaceKeys.list(), type: "all" });
      void qc.invalidateQueries({ queryKey: invitationKeys.mine() });
      return accepted;
    },
    { handledCodes: INVITE_HANDLED_CODES },
  );
