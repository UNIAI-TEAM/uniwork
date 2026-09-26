import { useCallback, useMemo } from "react";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import type { EmailHubAccountMenuProps } from "./email-hub-account-menu";

export function useEmailHubAccountPanel(
  accountList: EmailHubAccount[],
  accountId: string | null,
  setAccountId: (id: string | null) => void,
  setSelectedId: (id: string | null) => void,
  setConnectOpen: (open: boolean) => void,
  disconnect: {
    mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (err: unknown) => void; onSettled?: () => void }) => void;
    isPending: boolean;
  },
  onDisconnectError: (err: unknown) => void,
): EmailHubAccountMenuProps {
  const selectAccount = useCallback(
    (id: string) => {
      setAccountId(id);
      setSelectedId(null);
    },
    [setAccountId, setSelectedId],
  );

  const disconnectAccount = useCallback(
    (id: string, onDone: () => void) => {
      disconnect.mutate(id, {
        onSuccess: () => {
          if (accountId === id) {
            setAccountId(null);
            setSelectedId(null);
          }
        },
        onError: onDisconnectError,
        onSettled: onDone,
      });
    },
    [accountId, disconnect, onDisconnectError, setAccountId, setSelectedId],
  );

  return useMemo(
    () => ({
      accounts: accountList,
      activeAccountId: accountId,
      disconnectPending: disconnect.isPending,
      onSelectAccount: selectAccount,
      onDisconnect: disconnectAccount,
      onAddAccount: () => setConnectOpen(true),
    }),
    [accountId, accountList, disconnect.isPending, disconnectAccount, selectAccount, setConnectOpen],
  );
}
