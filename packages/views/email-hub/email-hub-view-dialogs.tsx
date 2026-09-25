"use client";

import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { ComposeEmailDialog } from "./compose-email-dialog";
import type { ComposeMode } from "./compose-recipients";
import { ConnectAccountDialog } from "./connect-account-dialog";

export function EmailHubViewDialogs({
  wsId,
  accountId,
  connectOpen,
  onConnectOpenChange,
  onConnected,
  composeOpen,
  onComposeOpenChange,
  composeMode,
  composeSource,
  onOpenScheduled,
}: {
  wsId: string;
  accountId: string | null;
  connectOpen: boolean;
  onConnectOpenChange: (open: boolean) => void;
  onConnected: (id: string) => void;
  composeOpen: boolean;
  onComposeOpenChange: (open: boolean) => void;
  composeMode: ComposeMode;
  composeSource: EmailHubThread | null;
  onOpenScheduled: () => void;
}) {
  return (
    <>
      <ConnectAccountDialog wsId={wsId} open={connectOpen} onOpenChange={onConnectOpenChange} onConnected={onConnected} />
      <ComposeEmailDialog
        wsId={wsId}
        accountId={accountId}
        open={composeOpen}
        onOpenChange={onComposeOpenChange}
        mode={composeMode}
        sourceThread={composeSource}
        onOpenScheduled={onOpenScheduled}
      />
    </>
  );
}
