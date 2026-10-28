// The choice screen's commands besides the doors (spec §3.2, §5.2): mailing a code to the address the person was
// invited with, and linking the held identity into the account they just signed in to. The doors themselves run
// through the auth store's login (data/auth/sign-in.ts). Each refusal is one the screens say in their own words
// (core's readSignInFailure), so none is reported as drift.
import { linkPendingTicket } from "../auth/methods-api";
import { sendClaimCode } from "../auth/sign-in";
import { useAuthStore } from "../auth/store";
import { useCommand } from "./command";

/** Rejects with a TransportError: invalid_request (the address), rate_limited (retry_after), or the ticket gone. */
export const useSendClaimCode = () =>
  useCommand("sign_in.claim_code", (_qc, email: string) => sendClaimCode(email), {
    handledCodes: ["invalid_request", "rate_limited", "sign_in_ticket_missing", "sign_in_ticket_channel", "sign_in_expired"],
  });

/**
 * "Liên kết": the held identity joins the signed-in account (move: after sign_in_method_movable, out of the empty
 * account holding it); the account the server answers with replaces the signed-in user.
 */
export const useLinkPendingTicket = () =>
  useCommand(
    "sign_in.link_ticket",
    async (_qc, input: { userId: string; move?: boolean }) => {
      const change = await linkPendingTicket(input);
      if (change.user) useAuthStore.getState().setUser(change.user);
      return change;
    },
    {
      handledCodes: [
        "sign_in_method_movable",
        "sign_in_method_taken",
        "sign_in_method_already_linked",
        "sign_in_account_conflict",
        "sign_in_ticket_missing",
        "sign_in_ticket_channel",
        "proof_required",
        "email_unverified",
        "sign_in_expired",
      ],
    },
  );
