// The account's own commands: delete it, sign another device out, answer the
// AI notice (push for this device is push.ts, to keep expo-notifications out
// of the screens that only need these). See command.ts for the layer's rule.
import { DELETE_ACCOUNT_HANDLED_CODES, type DeleteAccountBody } from "@/lib/account-deletion";
import { accountApi } from "../account-api";
import { answerAiConsent } from "../ai-consent";
import { deviceKeys, revokeDevice } from "../queries/devices";
import { useCommand } from "./command";

/** Rejects with the server's answer (data/account-api.ts reads it), for the screen to explain. */
export const useDeleteAccount = () =>
  useCommand("account.delete", (_qc, body: DeleteAccountBody) => accountApi.deleteAccount(body), { handledCodes: DELETE_ACCOUNT_HANDLED_CODES });

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
