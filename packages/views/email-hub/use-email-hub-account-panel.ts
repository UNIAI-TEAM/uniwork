import { useCallback, useMemo, useState } from "react";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import type { EmailHubAccountMenuProps } from "./email-hub-account-menu";

export function useEmailHubAvailableAccounts(accounts: EmailHubAccount[] | undefined) {
  // DELETE succeeded even if its follow-up refetch fails; never reactivate an id the server already removed.
  const [disconnectedIds, setDisconnectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const available = useMemo(() => {
    const byEmail = new Map<string, EmailHubAccount>();
    for (const account of accounts ?? []) {
      if (!disconnectedIds.has(account.id)) byEmail.set(account.email_address, account);
    }
    return [...byEmail.values()];
  }, [accounts, disconnectedIds]);
  const rememberDisconnected = useCallback((id: string) => {
    setDisconnectedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);
  return [available, rememberDisconnected] as const;
}

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
  onDisconnected: (id: string) => void,
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
          onDisconnected(id);
          if (accountId === id) {
            setAccountId(null);
            setSelectedId(null);
          }
        },
        onError: onDisconnectError,
        onSettled: onDone,
      });
    },
    [accountId, disconnect, onDisconnected, onDisconnectError, setAccountId, setSelectedId],
  );

  // The dialog picks the way back in from the account: auth_kind oauth_* opens its provider's sign-in popup with login_hint, provider "custom" reopens its server settings, any other asks for the app password.
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
