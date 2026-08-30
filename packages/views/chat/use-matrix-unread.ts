"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClientEvent, RoomEvent, SyncState, type MatrixClient } from "matrix-js-sdk";
import { canMarkRoomAsRead, markRoomAsRead, unreadCountForRoom } from "./matrix-unread";

const UNREAD_REFRESH_DEBOUNCE_MS = 200;

export function useMatrixUnread(
  client: MatrixClient | null,
  roomIds: string[],
  myMatrixUserId: string | null,
  activeRoomId: string | null,
): { counts: Record<string, number>; badgesReady: boolean } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [badgesReady, setBadgesReady] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const computeCounts = useCallback((): Record<string, number> => {
    if (!client || !myMatrixUserId) return {};
    const next: Record<string, number> = {};
    for (const roomId of roomIds) {
      if (!roomId) continue;
      const count = unreadCountForRoom(client, roomId, myMatrixUserId);
      next[roomId] = roomId === activeRoomId ? 0 : count;
    }
    return next;
  }, [client, myMatrixUserId, roomIds, activeRoomId]);

  const refreshNow = useCallback(() => {
    if (!client || !myMatrixUserId || !badgesReady) return;
    setCounts(computeCounts());
  }, [client, myMatrixUserId, badgesReady, computeCounts]);

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      refreshNow();
    }, UNREAD_REFRESH_DEBOUNCE_MS);
  }, [refreshNow]);

  useEffect(() => {
    if (!client) {
      setBadgesReady(false);
      return;
    }

    const activate = (state: SyncState | null) => {
      if (state !== SyncState.Prepared) return;
      setBadgesReady(true);
    };

    activate(client.getSyncState());
    const onSync = (state: SyncState) => activate(state);
    client.on(ClientEvent.Sync, onSync);

    return () => {
      client.removeListener(ClientEvent.Sync, onSync);
      setBadgesReady(false);
    };
  }, [client]);

  useEffect(() => {
    if (!badgesReady) return;
    refreshNow();
  }, [badgesReady, refreshNow]);

  useEffect(() => {
    if (!client || !badgesReady) return;

    const onActivity = () => scheduleRefresh();

    client.on(ClientEvent.Sync, onActivity);
    client.on(RoomEvent.Timeline, onActivity);

    return () => {
      client.removeListener(ClientEvent.Sync, onActivity);
      client.removeListener(RoomEvent.Timeline, onActivity);
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [client, badgesReady, scheduleRefresh]);

  return { counts, badgesReady };
}

const MARK_READ_RETRY_MS = 500;
const MARK_READ_MAX_ATTEMPTS = 24;

export function useMarkRoomAsRead(
  client: MatrixClient | null,
  roomId: string | null,
  enabled: boolean,
  messageCount = 0,
): void {
  useEffect(() => {
    if (!client || !roomId || !enabled) return;

    let cancelled = false;
    let attempts = 0;
    let intervalId: number | null = null;

    const tryMark = async (): Promise<boolean> => {
      if (cancelled || !canMarkRoomAsRead(client, roomId)) return false;
      try {
        await markRoomAsRead(client, roomId);
        return true;
      } catch {
        return false;
      }
    };

    const scheduleRetry = () => {
      if (intervalId != null) return;
      intervalId = window.setInterval(() => {
        attempts += 1;
        void tryMark().then((done) => {
          if (done || attempts >= MARK_READ_MAX_ATTEMPTS) {
            if (intervalId != null) window.clearInterval(intervalId);
            intervalId = null;
          }
        });
      }, MARK_READ_RETRY_MS);
    };

    void tryMark().then((done) => {
      if (!done && !cancelled) scheduleRetry();
    });

    const onActivity = () => {
      void tryMark().then((done) => {
        if (done && intervalId != null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      });
    };

    client.on(ClientEvent.Sync, onActivity);
    client.on(ClientEvent.Room, onActivity);
    client.on(RoomEvent.Timeline, onActivity);

    return () => {
      cancelled = true;
      if (intervalId != null) window.clearInterval(intervalId);
      client.removeListener(ClientEvent.Sync, onActivity);
      client.removeListener(ClientEvent.Room, onActivity);
      client.removeListener(RoomEvent.Timeline, onActivity);
    };
  }, [client, roomId, enabled, messageCount]);
}
