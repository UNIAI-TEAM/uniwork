// What changed in a workspace's chat since this phone last looked, read from
// the server's change log (GET .../chat/sync, ADR 0039 draft phase 1) instead
// of refetching every page of every timeline on screen: a reconnect, or a
// minute of silence on a live socket (a frame the relay lost), costs one small
// request. The server sends each changed message as it is now, so applying a
// change twice, or one the screen already had from a frame, changes nothing.
//
// Each change lands as a frame would (realtime/chat-realtime.ts): on a
// timeline someone shows it is patched in; one nobody shows is marked stale
// and its copy on disk dropped for an edit or a delete; a thread refetches
// where it is shown and its root's reply count is read again. Outcomes:
//   synced       every change applied; nothing else to refetch;
//   reset        the log has moved past this phone (or never knew it), or
//                more than MAX_SYNC_PAGES pages wait: the caller reloads what
//                it shows; the head is the new start;
//   unavailable  the switch is off, the request failed, the answer did not
//                parse, or this phone had no head yet (the head is now set):
//                the caller does what it did before the log.
import type { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { isChatThreadReply } from "@uniwork/core/chat/chat-cache-records";
import { markStaleUnlessObserved } from "@uniwork/core/chat/room-timeline-cache";
import { applyChatMessageResponse, patchChatMessageDeleted } from "../chat-cache";
import { chatApi, type ChatApi } from "../chat-api";
import { chatKeys } from "../queries/chat-keys";
import { dropCarriedTimeline } from "../query-persister";
import { readMobileFlag } from "../remote-config";
import { bestEffort } from "../report";
import { chatSyncApi, type ChatSyncApi, type ChatSyncChange } from "./api";
import { chatSyncHeads, type ChatSyncHeads } from "./heads";

export type ChatSyncOutcome = "synced" | "reset" | "unavailable";

/**
 * The server pages its answer (200 changes a page, `more` when more follow).
 * A phone follows this many pages in one sync; a longer backlog (a long
 * night offline in a busy room) costs less to reload than to replay.
 */
export const MAX_SYNC_PAGES = 5;

export interface ChatSyncDeps {
  api: Pick<ChatSyncApi, "sync">;
  heads: ChatSyncHeads;
  getMessage: ChatApi["getMessage"];
}

const appDeps: ChatSyncDeps = { api: chatSyncApi, heads: chatSyncHeads, getMessage: chatApi.getMessage };

interface Applied {
  /** Thread roots of shown rooms whose reply count moved: rootId → roomId. */
  roots: Map<string, string>;
  /** A new message landed in a room nobody shows: the list's previews and badges follow. */
  listStale: boolean;
}

function applyMessage(qc: QueryClient, wsId: string, change: ChatSyncChange, message: ChatMessageRecord, applied: Applied): void {
  const roomId = change.room_id;
  const created = change.kind === "created";
  if (isChatThreadReply(message)) {
    const rootId = message.thread_root_id!;
    // A reply lands in its thread, which refetches where shown; the root's count on the room is read again.
    void qc.invalidateQueries({ queryKey: chatKeys.threadMessages(wsId, roomId, rootId), exact: true });
    if (created) applied.roots.set(rootId, roomId);
    return;
  }
  if (markStaleUnlessObserved(qc, chatKeys.roomMessages(wsId, roomId))) {
    applyChatMessageResponse(qc, wsId, roomId, message, created);
    return;
  }
  // Nobody shows the room: the next open reads it. A copy only the disk holds would keep an edit's old body.
  if (created) applied.listStale = true;
  else dropCarriedTimeline(wsId, roomId);
}

async function refreshRoots(qc: QueryClient, wsId: string, roots: Map<string, string>, deps: ChatSyncDeps): Promise<void> {
  await Promise.all(
    [...roots].map(async ([rootId, roomId]) => {
      if (!markStaleUnlessObserved(qc, chatKeys.roomMessages(wsId, roomId))) return;
      const root = await deps.getMessage(wsId, roomId, rootId).catch(bestEffort("chat-sync", "thread root not read", "breadcrumb"));
      if (root) applyChatMessageResponse(qc, wsId, roomId, root, false);
    }),
  );
}

function applyPage(qc: QueryClient, wsId: string, changes: readonly ChatSyncChange[]): Applied {
  const applied: Applied = { roots: new Map(), listStale: false };
  for (const change of changes) {
    if (change.message && change.kind !== "deleted") applyMessage(qc, wsId, change, change.message, applied);
    else patchChatMessageDeleted(qc, wsId, change.room_id, change.message_id);
  }
  if (applied.listStale) {
    void qc.invalidateQueries({ queryKey: chatKeys.rooms(wsId) });
    void qc.invalidateQueries({ queryKey: chatKeys.unreadSummary() });
  }
  return applied;
}

async function run(qc: QueryClient, wsId: string, userId: string, deps: ChatSyncDeps): Promise<ChatSyncOutcome> {
  if (!readMobileFlag(qc, "unichat_mobile_chat_sync")) return "unavailable";
  const first = await deps.heads.get(userId, wsId);
  let since = first;
  for (let pages = 1; ; pages += 1) {
    const page = await deps.api.sync(wsId, since).catch(bestEffort("chat-sync", "sync failed", "breadcrumb"));
    if (!page) return "unavailable";
    if (first === null || page.reset) {
      await deps.heads.set(userId, wsId, page.head);
      return first === null ? "unavailable" : "reset";
    }
    await refreshRoots(qc, wsId, applyPage(qc, wsId, page.changes).roots, deps);
    // Only once applied: a process killed halfway replays them (each is the message as it is now).
    await deps.heads.set(userId, wsId, page.head);
    if (page.more !== true) return "synced";
    if (pages >= MAX_SYNC_PAGES) return "reset";
    since = page.head;
  }
}

const running = new Map<string, Promise<ChatSyncOutcome>>();

/** One sync per person and workspace at a time: a second ask while one runs shares its answer. */
export function syncChat(qc: QueryClient, wsId: string, userId: string, deps: ChatSyncDeps = appDeps): Promise<ChatSyncOutcome> {
  const key = `${userId}\n${wsId}`;
  const current = running.get(key);
  if (current) return current;
  const next = run(qc, wsId, userId, deps).finally(() => running.delete(key));
  running.set(key, next);
  return next;
}
