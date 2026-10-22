// The account's own commands: delete it, sign another device out, answer the
// AI notice, show or hide message text in pushes (push for this device is push.ts, to keep expo-notifications out
// of the screens that only need these). See command.ts for the layer's rule.
import { DELETE_ACCOUNT_HANDLED_CODES, type DeleteAccountBody } from "@/lib/account-deletion";
import { CLOSE_ORGANIZATION_HANDLED_CODES, type CloseOrganizationBody } from "@/lib/owned-organization";
import { TRANSFER_OWNERSHIP_HANDLED_CODES } from "@/lib/owner-transfer";
import { accountApi } from "../account-api";
import { answerAiConsent } from "../ai-consent";
import { setPushPreviews } from "../push-previews";
import { deviceKeys, revokeDevice } from "../queries/devices";
import { useCommand } from "./command";

/** Rejects with the server's answer (data/account-api.ts reads it), for the screen to explain. */
export const useDeleteAccount = () =>
  useCommand("account.delete", (_qc, body: DeleteAccountBody & CloseOrganizationBody) => accountApi.deleteAccount(body), {
    handledCodes: [...DELETE_ACCOUNT_HANDLED_CODES, ...CLOSE_ORGANIZATION_HANDLED_CODES],
  });

/** Hands the organization to another active member, the owner's password again; rejects with the server's answer. */
export const useTransferOwnership = () =>
  useCommand(
    "account.transfer_ownership",
    (_qc, input: { orgSlug: string; toUserId: string; password: string }) =>
      accountApi.transferOwnership(input.orgSlug, input.toUserId, input.password),
    { handledCodes: TRANSFER_OWNERSHIP_HANDLED_CODES },
  );

/** Signs a device out; the list refreshes whether or not the server agreed. */
export const useRevokeDevice = () =>
  useCommand("account.revoke_device", async (qc, deviceSessionId: string) => {
    try {
      await revokeDevice(deviceSessionId);
    } finally {
      void qc.invalidateQueries({ queryKey: deviceKeys.all() });
    }
  });

/** Agree to (true) or withdraw from (false) the AI notice; the signed-in user follows (data/ai-consent.ts). */
export const useAnswerAiConsent = () => useCommand("account.ai_consent", (_qc, agree: boolean) => answerAiConsent(agree));

/** Show (true) or hide (false) the message's words in this person's chat pushes; the signed-in user follows (data/push-previews.ts). */
export const useSetPushPreviews = () => useCommand("account.push_previews", (_qc, show: boolean) => setPushPreviews(show));
