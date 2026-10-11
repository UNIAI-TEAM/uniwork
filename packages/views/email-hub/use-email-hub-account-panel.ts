import { useCallback, useMemo } from "react";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import type { EmailHubAccountMenuProps } from "./email-hub-account-menu";

export function useEmailHubAccountPanel(
  accountList: EmailHubAccount[],
  accountId: string | null,
  setAccountId: (id: string | null) => void,
  setSelectedId: (id: string | null) => void,
  /** "" opens the connect dialog empty; an address reopens it to reconnect that mailbox. */
  openConnect: (email: string) => void,
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

  // The dialog picks the form: provider "custom" reopens its server settings, any other asks for the app password. GĐ3 picks the OAuth popup here by auth_kind.
  const reconnectAccount = useCallback(
    (id: string) => {
      const acc = accountList.find((item) => item.id === id);
      if (acc) openConnect(acc.email_address);
    },
    [accountList, openConnect],
  );

  return useMemo(
    () => ({
      accounts: accountList,
      activeAccountId: accountId,
      disconnectPending: disconnect.isPending,
      onSelectAccount: selectAccount,
      onDisconnect: disconnectAccount,
      onAddAccount: () => openConnect(""),
      onReconnect: reconnectAccount,
    }),
    [accountId, accountList, disconnect.isPending, disconnectAccount, openConnect, reconnectAccount, selectAccount],
  );
}
