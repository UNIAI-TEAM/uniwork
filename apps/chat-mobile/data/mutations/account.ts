// The account's own commands: delete it, sign another device out. See
// command.ts for the layer's rule.
import type { DeleteAccountBody } from "@/lib/account-deletion";
import { accountApi } from "../account-api";
import { deviceKeys, revokeDevice } from "../queries/devices";
import { useCommand } from "./command";

/** Rejects with the server's answer (data/account-api.ts reads it), for the screen to explain. */
export const useDeleteAccount = () => useCommand("account.delete", (_qc, body: DeleteAccountBody) => accountApi.deleteAccount(body));

/** Signs a device out; the list refreshes whether or not the server agreed. */
export const useRevokeDevice = () =>
  useCommand("account.revoke_device", async (qc, deviceSessionId: string) => {
    try {
      await revokeDevice(deviceSessionId);
    } finally {
      void qc.invalidateQueries({ queryKey: deviceKeys.all() });
    }
  });
