import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { errorCode } from "../api/http";
import * as api from "../api/endpoints/email-hub";
import { emailHubKeys, invalidateEmailHubThreadsForAccount, invalidateEmailHubUnread } from "./query-cache";

const emailHubLazySyncFolders = new Set(["SENT", "DRAFTS", "TRASH", "ARCHIVE", "SPAM"]);
/** IMAP-heavy folders: soft sync once when opened; force sync still when list is empty. */
const emailHubHeavyLazySyncFolders = new Set(["ARCHIVE", "TRASH", "SPAM"]);
/** Virtual list folders (no IMAP mailbox): refresh list + inbox sync for snooze wake-ups. */
const emailHubVirtualRefreshFolders = new Set(["SNOOZED"]);

export function emailHubLazySyncShowsSyncing(folder: string): boolean {
  return emailHubLazySyncFolders.has(folder) || emailHubVirtualRefreshFolders.has(folder);
}

const emailHubFolderSyncInflight = new Set<string>();

type EmailHubLazyFolderSyncOpts = {
  listFetched: boolean;
  listTotal: number;
  skip?: boolean;
};

function runEmailHubFolderSync(
  wsId: string,
  accountId: string,
  folder: string,
  force: boolean,
  onSynced: () => void,
  onSettled?: () => void,
) {
  const key = `${accountId}:${folder}`;
  if (emailHubFolderSyncInflight.has(key)) {
    onSettled?.();
    return;
  }
  emailHubFolderSyncInflight.add(key);
  void api
    .syncEmailHub(wsId, accountId, folder, force, false, false)
    .then(
      (res) => {
        if (res?.synced) onSynced();
      },
      () => {
        /* best-effort; user can refresh manually */
      },
    )
    .finally(() => {
      emailHubFolderSyncInflight.delete(key);
      onSettled?.();
    });
}

/** Pull IMAP for folders not covered by the inbox live watcher (e.g. Archive). */
export function useEmailHubLazyFolderSync(
  wsId: string,
  accountId: string | null,
  folder: string,
  opts: EmailHubLazyFolderSyncOpts,
) {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const emptyForceKey = useRef("");
  const heavyOpenKey = useRef("");
  const virtualOpenKey = useRef("");

  useEffect(() => {
    emptyForceKey.current = "";
    heavyOpenKey.current = "";
    virtualOpenKey.current = "";
  }, [accountId, folder]);

  useEffect(() => {
    if (!accountId || !emailHubHeavyLazySyncFolders.has(folder) || opts.skip) {
      return;
    }
    const token = `${accountId}:${folder}`;
    if (heavyOpenKey.current === token) return;
    heavyOpenKey.current = token;
    let cancelled = false;
    setSyncing(true);
    runEmailHubFolderSync(
      wsId,
      accountId,
      folder,
      false,
      () => invalidateEmailHubThreadsForAccount(qc, wsId, accountId),
      () => {
        if (!cancelled) setSyncing(false);
      },
    );
    return () => {
      cancelled = true;
      setSyncing(false);
    };
  }, [accountId, folder, opts.skip, qc, wsId]);

  useEffect(() => {
    if (!accountId || !emailHubVirtualRefreshFolders.has(folder) || opts.skip) {
      return;
    }
    const token = `${accountId}:${folder}`;
    if (virtualOpenKey.current === token) return;
    virtualOpenKey.current = token;
    let cancelled = false;
    setSyncing(true);
    void qc.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "email-hub" &&
        q.queryKey[1] === wsId &&
        q.queryKey[2] === "threads" &&
        q.queryKey[3] === accountId &&
        q.queryKey[4] === folder,
      refetchType: "active",
    });
    runEmailHubFolderSync(
      wsId,
      accountId,
      "INBOX",
      false,
      () => invalidateEmailHubThreadsForAccount(qc, wsId, accountId),
      () => {
        if (!cancelled) setSyncing(false);
      },
    );
    return () => {
      cancelled = true;
      setSyncing(false);
    };
  }, [accountId, folder, opts.skip, qc, wsId]);

  useEffect(() => {
    if (!accountId) {
      setSyncing(false);
      return;
    }
    if (!emailHubLazySyncFolders.has(folder) && !emailHubVirtualRefreshFolders.has(folder)) {
      setSyncing(false);
      return;
    }
    if (!emailHubLazySyncFolders.has(folder)) {
      return;
    }
    if (emailHubHeavyLazySyncFolders.has(folder)) {
      return;
    }
    let cancelled = false;
    setSyncing(true);
    runEmailHubFolderSync(
      wsId,
      accountId,
      folder,
      false,
      () => invalidateEmailHubThreadsForAccount(qc, wsId, accountId),
      () => {
        if (!cancelled) setSyncing(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wsId, accountId, folder, qc]);

  useEffect(() => {
    if (!accountId || !emailHubLazySyncFolders.has(folder) || opts.skip) return;
    if (!opts.listFetched || opts.listTotal > 0) return;
    const token = `${accountId}:${folder}`;
    if (emptyForceKey.current === token) return;
    emptyForceKey.current = token;
    let cancelled = false;
    setSyncing(true);
    runEmailHubFolderSync(
      wsId,
      accountId,
      folder,
      true,
      () => invalidateEmailHubThreadsForAccount(qc, wsId, accountId),
      () => {
        if (!cancelled) setSyncing(false);
      },
    );
    return () => {
      cancelled = true;
      setSyncing(false);
    };
  }, [accountId, folder, opts.listFetched, opts.listTotal, opts.skip, qc, wsId]);

  return syncing;
}

const emailHubLivePollMs = 45_000;
const emailHubSafetyPollMs = 5 * 60_000;

/**
 * A 409 email_hub_reauth_required means the cached account list is stale. Refetch it
 * once: it brings needs_reconnect, and the page then turns this hook off.
 */
function refetchAccountsOnReauth(err: unknown, seen: { current: boolean }, qc: QueryClient, wsId: string) {
  if (seen.current || errorCode(err) !== "email_hub_reauth_required") return;
  seen.current = true;
  void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
}

/**
 * Server-side INBOX watch while Email Hub is open. Changes arrive via WebSocket;
 * heartbeat re-subscribes after reconnect. Rare poll when not reading a message.
 */
export function useEmailHubLiveSync(
  wsId: string,
  accountId: string | null,
  enabled = true,
  readingEmail = false,
) {
  const qc = useQueryClient();
  const reauthSeen = useRef(false);
  // The server stops the watch on DELETE and keeps it while heartbeats renew
  // its lease, so this effect must not re-run when the reader opens a message.
  useEffect(() => {
    if (!enabled || !accountId) return;
    reauthSeen.current = false;
    let cancelled = false;

    const subscribe = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        await api.subscribeEmailHubInboxWatch(wsId, accountId);
      } catch (err) {
        refetchAccountsOnReauth(err, reauthSeen, qc, wsId);
      }
    };

    void subscribe();
    const heartbeat = window.setInterval(() => {
      if (!cancelled) void subscribe();
    }, emailHubLivePollMs);
    const onVisible = () => void subscribe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
      void api.unsubscribeEmailHubInboxWatch(wsId, accountId).catch(() => {});
    };
  }, [wsId, accountId, enabled, qc]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    const pullInbox = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await api.syncEmailHub(wsId, accountId, "INBOX", false, true, false);
        if (res.synced) {
          invalidateEmailHubThreadsForAccount(qc, wsId, accountId);
          invalidateEmailHubUnread(qc, wsId);
        }
      } catch (err) {
        refetchAccountsOnReauth(err, reauthSeen, qc, wsId);
      }
    };

    void pullInbox();
    let fallbackTimer: number | undefined;
    if (!readingEmail) {
      fallbackTimer = window.setInterval(() => {
        void pullInbox();
      }, emailHubSafetyPollMs);
    }
    const onVisible = () => void pullInbox();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wsId, accountId, enabled, readingEmail, qc]);
}
