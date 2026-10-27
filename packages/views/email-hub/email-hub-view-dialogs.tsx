"use client";

import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { ComposeEmailDialog } from "./compose-email-dialog";
import type { ComposeMode } from "./compose-recipients";
import { ConnectAccountDialog } from "./connect-account-dialog";
import { focusTargetAfterConnect } from "./email-hub-account-menu";

export function EmailHubViewDialogs({
  wsId,
  accountId,
  connectEmail,
  onConnectEmailChange,
  onConnected,
  composeOpen,
  onComposeOpenChange,
  composeMode,
  composeSource,
  onScheduledCreated,
  onOpenScheduled,
}: {
  wsId: string;
  accountId: string | null;
  /** null: closed; "": connect a new mailbox; an address: reconnect that one. */
  connectEmail: string | null;
  onConnectEmailChange: (email: string | null) => void;
  onConnected: (id: string) => void;
  composeOpen: boolean;
  onComposeOpenChange: (open: boolean) => void;
  composeMode: ComposeMode;
  composeSource: EmailHubThread | null;
  onScheduledCreated: (accountId: string) => void;
  onOpenScheduled: () => void;
}) {
  return (
    <>
      <ConnectAccountDialog
        wsId={wsId}
        open={connectEmail !== null}
        reconnectEmail={connectEmail || undefined}
        onOpenChange={(open) => {
          if (!open) onConnectEmailChange(null);
        }}
        onConnected={onConnected}
        focusAfterConnect={focusTargetAfterConnect}
      />
      <ComposeEmailDialog
        wsId={wsId}
        accountId={accountId}
        open={composeOpen}
        onOpenChange={onComposeOpenChange}
        mode={composeMode}
        sourceThread={composeSource}
        onScheduledCreated={onScheduledCreated}
        onOpenScheduled={onOpenScheduled}
      />
    </>
  );
}
