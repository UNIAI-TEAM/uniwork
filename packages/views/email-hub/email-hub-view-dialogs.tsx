"use client";

import type { EmailHubThread } from "@uniwork/core/types/email-hub";
import { ComposeEmailDialog } from "./compose-email-dialog";
import type { ComposeMode } from "./compose-recipients";
import { ConnectAccountDialog } from "./connect-account-dialog";
import type { EmailHubFolderKey } from "./email-hub-folder-sidebar";

type FolderKey = EmailHubFolderKey;

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
  onSent,
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
  onSent: (result: EmailHubThread | { scheduled: true; send_at: string } | null) => void;
}) {
  return (
    <>
      <ConnectAccountDialog
        wsId={wsId}
        open={connectOpen}
        onOpenChange={onConnectOpenChange}
        onConnected={onConnected}
      />
      <ComposeEmailDialog
        wsId={wsId}
        accountId={accountId}
        open={composeOpen}
        onOpenChange={onComposeOpenChange}
        mode={composeMode}
        sourceThread={composeSource}
        onSent={onSent}
      />
    </>
  );
}

export type { FolderKey };
