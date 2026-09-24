import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/email-hub";
import { invalidateEmailHubThreadsForAccount, invalidateEmailHubUnread } from "./query-cache";

const emailHubLazySyncFolders = new Set(["SENT", "DRAFTS", "TRASH", "ARCHIVE", "SPAM"]);
/** IMAP-heavy folders: one forced sync when cache is empty (skip soft sync on open). */
const emailHubHeavyLazySyncFolders = new Set(["ARCHIVE", "TRASH", "SPAM"]);

export function emailHubLazySyncShowsSyncing(folder: string): boolean {
  return emailHubLazySyncFolders.has(folder);
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

  useEffect(() => {
    emptyForceKey.current = "";
  }, [accountId, folder]);

  useEffect(() => {
    if (!accountId || !emailHubLazySyncFolders.has(folder)) {
      setSyncing(false);
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
    };
  }, [accountId, folder, opts.listFetched, opts.listTotal, opts.skip, qc, wsId]);

  return syncing;
}

const emailHubLivePollMs = 45_000;
const emailHubSafetyPollMs = 5 * 60_000;

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
  useEffect(() => {
    if (!enabled || !accountId) return;
    let cancelled = false;

    const subscribe = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        await api.subscribeEmailHubInboxWatch(wsId, accountId);
      } catch {
        /* retry on next heartbeat */
      }
    };

    const pullInbox = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await api.syncEmailHub(wsId, accountId, "INBOX", false, true, false);
        if (res.synced) {
          invalidateEmailHubThreadsForAccount(qc, wsId, accountId);
          invalidateEmailHubUnread(qc, wsId);
        }
      } catch {
        /* retry on next tick */
      }
    };

    void subscribe();
    void pullInbox();

    const heartbeat = window.setInterval(() => {
      if (!cancelled) void subscribe();
    }, emailHubLivePollMs);

    let fallbackTimer: number | undefined;
    if (!readingEmail) {
      fallbackTimer = window.setInterval(() => {
        void pullInbox();
      }, emailHubSafetyPollMs);
    }

    const onVisible = () => {
      void subscribe();
      void pullInbox();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisible);
      void api.unsubscribeEmailHubInboxWatch(wsId, accountId).catch(() => {});
    };
  }, [wsId, accountId, enabled, readingEmail, qc]);
}
