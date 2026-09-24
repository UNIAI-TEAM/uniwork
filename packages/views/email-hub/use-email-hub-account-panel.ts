import { useCallback, useMemo, type ComponentProps } from "react";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import type { EmailHubAccountsPanel } from "./email-hub-accounts-panel";

type AccountPanelProps = ComponentProps<typeof EmailHubAccountsPanel>;

export function useEmailHubAccountPanel(
  accountList: EmailHubAccount[],
  accountId: string | null,
  setAccountId: (id: string | null) => void,
  setSelectedId: (id: string | null) => void,
  setConnectOpen: (open: boolean) => void,
  disconnect: { mutate: (id: string, opts?: { onSuccess?: () => void }) => void; isPending: boolean },
): AccountPanelProps {
  const selectAccount = useCallback(
    (id: string) => {
      setAccountId(id);
      setSelectedId(null);
    },
    [setAccountId, setSelectedId],
  );

  const disconnectAccount = useCallback(
    (id: string) => {
      disconnect.mutate(id, {
        onSuccess: () => {
          if (accountId === id) {
            setAccountId(null);
            setSelectedId(null);
          }
        },
      });
    },
    [accountId, disconnect, setAccountId, setSelectedId],
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
