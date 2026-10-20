"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "@uniwork/core/platform";
import type { ChatMessage } from "./chat-messages";
import { toastChatError } from "./chat-error-message";
import { useFreshChatMediaUrl } from "./use-chat-media-url";

/** `total` is null while the size is unknown: the card shows a spinner, not a bar. */
export type ChatFileDownloadState =
  | { status: "idle" }
  | { status: "downloading"; loaded: number; total: number | null }
  | { status: "done" }
  | { status: "failed" };

const IDLE: ChatFileDownloadState = { status: "idle" };
/** How long a finished download shows its check before the card rests again. */
const DONE_MS = 2000;

/**
 * Downloads by message, outside React: a card the virtual list scrolls away
 * and back finds its progress again, and the download outlives the card.
 */
const states = new Map<string, ChatFileDownloadState>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function setState(messageId: string, state: ChatFileDownloadState) {
  if (state.status === "idle") states.delete(messageId);
  else states.set(messageId, state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whole percent of a download, 0–100. */
export function chatDownloadPercent(loaded: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100))) : 0;
}

/**
 * Reads a storage URL into a Blob, reporting bytes as they arrive against the
 * response's Content-Length, else the size the message declares. Null when the
 * request never got an answer (storage without CORS, offline): the caller
 * hands the URL to the browser's own download instead.
 */
export async function fetchChatFileBlob(
  url: string,
  sizeHint: number | undefined,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number | null) => void,
): Promise<Blob | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
  if (!res.ok || !res.body) throw new Error(`chat file download: ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || sizeHint || null;
  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks, { type: res.headers.get("Content-Type") ?? "" });
}

function save(href: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
}

/**
 * Downloads a file message from storage with its progress and a cancel. The
 * signed download URL carries Content-Disposition: attachment with the file's
 * name, so the fallback (a plain link) saves under the right name even though
 * the anchor's download attribute is ignored cross-origin. In UniChat the
 * shell's native download takes it; the bridge reports no progress, so the
 * card spins until it has started. The message is picked at click time, so
 * one hook serves every photo of an album viewer; `messageId` is the one whose
 * state the caller shows.
 */
export function useChatFileDownload(workspaceId: string, roomId: string, messageId?: string) {
  const { t } = useTranslation();
  const freshUrl = useFreshChatMediaUrl(workspaceId, roomId);
  const state = useSyncExternalStore(
    subscribe,
    () => (messageId && states.get(messageId)) || IDLE,
    () => IDLE,
  );

  const run = useCallback(
    async (message: ChatMessage) => {
      const id = message.id;
      if (states.get(id)?.status === "downloading") return;
      const controller = new AbortController();
      controllers.set(id, controller);
      const sizeHint = message.file?.size_bytes || undefined;
      setState(id, { status: "downloading", loaded: 0, total: sizeHint ?? null });
      try {
        const url = await freshUrl(
          id,
          { url: message.file?.download_url, expiresAt: message.file?.url_expires_at },
          (fresh) => fresh.file?.download_url,
        );
        const name = message.file?.filename || "file";
        const bridge = getDesktopBridge();
        if (bridge) {
          setState(id, { status: "downloading", loaded: 0, total: null });
          await bridge.downloadURL(url, name);
          setState(id, IDLE);
          return;
        }
        const blob = await fetchChatFileBlob(url, sizeHint, controller.signal, (loaded, total) =>
          setState(id, { status: "downloading", loaded, total }),
        );
        if (!blob) {
          save(url, name);
          setState(id, IDLE);
          return;
        }
        const href = URL.createObjectURL(blob);
        save(href, name);
        // The browser reads the blob after the click returns.
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
        setState(id, { status: "done" });
        setTimeout(() => {
          if (states.get(id)?.status === "done") setState(id, IDLE);
        }, DONE_MS);
      } catch (err) {
        if (controller.signal.aborted) {
          setState(id, IDLE);
          return;
        }
        setState(id, { status: "failed" });
        toastChatError(err, t, t("chat.file_download_failed"));
      } finally {
        controllers.delete(id);
      }
    },
    [freshUrl, t],
  );

  return {
    state,
    busy: state.status === "downloading",
    download: (message: ChatMessage) => void run(message),
    cancel: () => {
      if (messageId) controllers.get(messageId)?.abort();
    },
  };
}
