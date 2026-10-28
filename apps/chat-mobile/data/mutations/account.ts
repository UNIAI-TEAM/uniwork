// The account's own commands: delete it, sign another device out, answer the
// AI notice, prove its address with the mailed code,
// show or hide message text in pushes (push for this device is push.ts, to keep expo-notifications out
// of the screens that only need these). See command.ts for the layer's rule.
import { DELETE_ACCOUNT_HANDLED_CODES, type DeleteAccountBody } from "@/lib/account-deletion";
import { CLOSE_ORGANIZATION_HANDLED_CODES, type CloseOrganizationBody } from "@/lib/owned-organization";
import { TRANSFER_OWNERSHIP_HANDLED_CODES } from "@/lib/owner-transfer";
import { accountApi } from "../account-api";
import { answerAiConsent } from "../ai-consent";
import { withHeldStepUp } from "../auth/step-up-store";
import { verifyAccountEmail } from "../auth/verify-email";
import { setPushPreviews } from "../push-previews";
import { deviceKeys, revokeDevice } from "../queries/devices";
import { useCommand } from "./command";

/**
 * Erases the account with the step-up token bought for delete_account; rejects with the server's answer for the
 * screen to explain (a refused token is forgotten first, so the proof sheet asks again).
 */
export const useDeleteAccount = () =>
  useCommand(
    "account.delete",
    (_qc, body: DeleteAccountBody & CloseOrganizationBody) => withHeldStepUp(() => accountApi.deleteAccount(body)),
    { handledCodes: [...DELETE_ACCOUNT_HANDLED_CODES, ...CLOSE_ORGANIZATION_HANDLED_CODES] },
  );

/** Hands the organization to another active member, with the step-up token for transfer_ownership. */
export const useTransferOwnership = () =>
  useCommand(
    "account.transfer_ownership",
    (_qc, input: { orgSlug: string; toUserId: string; stepUpToken: string }) =>
      withHeldStepUp(() => accountApi.transferOwnership(input.orgSlug, input.toUserId, input.stepUpToken)),
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

/** The mailed code proves the address; the signed-in user follows (data/auth/verify-email.ts). A wrong code rejects. */
export const useVerifyEmail = () =>
  useCommand("account.verify_email", (_qc, code: string) => verifyAccountEmail(code), { handledCodes: ["invalid_code"] });

/** Mails a fresh code; within a minute of the last one the server answers 429. */
export const useResendVerification = () => useCommand("account.resend_verification", (_qc, _: void) => accountApi.resendVerification());
