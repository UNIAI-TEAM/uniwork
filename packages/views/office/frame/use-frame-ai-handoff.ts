"use client";

import { useMemo, useRef } from "react";
import { useOfficeHandoffStore } from "@uniwork/core/ai/office-handoff";
import type { DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import type { InitAck } from "@uniwork/core/office/docs-frame-protocol";

/** What the frame session needs to hand Ask UNI's approved job to the editor AI (UNI-2264). */
export interface FrameAiHandoffBinding {
  /**
   * A handshake completed: the frame's capabilities are known. A `lockedOut` handshake is read-only only because
   * the edit lock was not held yet, and holding it re-attaches the frame in edit mode: it neither sends nor refuses.
   */
  attach(host: DocsFrameHost, ack: InitAck, lockedOut: boolean): void;
  /**
   * The host answered an `api.open` served by `host`. It may come before `attach`: the frame posts its boot
   * open before the init ack, so what counts is the endpoint, not the order.
   */
  documentOpened(host: DocsFrameHost): void;
  /** The frame endpoint is gone (retry, unmount). */
  detach(): void;
  /** The frame's AI started or finished a turn. */
  onAiRun(state: "running" | "idle"): void;
}

/**
 * Sends the queued job once, after the handshake AND the document open of the same frame endpoint, in either order.
 * The store entry is consumed by `take`, so a remount, a retry or a second open sends nothing twice.
 */
export function useFrameAiHandoff(documentId: string): FrameAiHandoffBinding {
  const idRef = useRef(documentId);
  idRef.current = documentId;
  return useMemo(() => {
    let host: DocsFrameHost | null = null;
    let ack: InitAck | null = null;
    let openedOn: DocsFrameHost | null = null;

    const start = () => {
      if (!host || !ack || openedOn !== host) return;
      const id = idRef.current;
      const store = useOfficeHandoffStore.getState();
      const entry = store.take(id);
      if (!entry) return;
      if (ack.capabilities.aiStart !== true) {
        store.setStatus(id, "refused");
        return;
      }
      host.startAi({ handoffId: entry.handoffId, text: entry.text, displayText: entry.text }).then(
        () => {
          const now = useOfficeHandoffStore.getState();
          // Keeps the store at "sent" unless a run event already moved it on.
          if (now.byDocument[id]?.status === "sent") now.setStatus(id, "sent");
        },
        () => { useOfficeHandoffStore.getState().setStatus(id, "refused"); },
      );
    };

    return {
      attach(nextHost, nextAck, lockedOut) {
        host = lockedOut ? null : nextHost;
        ack = lockedOut ? null : nextAck;
        start();
      },
      documentOpened(opener) {
        openedOn = opener;
        start();
      },
      detach() {
        host = null;
        ack = null;
        openedOn = null;
      },
      onAiRun(state) {
        const store = useOfficeHandoffStore.getState();
        const current = store.byDocument[idRef.current]?.status;
        // Only a job the frame was sent: a pending one would never be taken, a refused one stays refused.
        if (current === "sent" || current === "running" || current === "idle") store.setStatus(idRef.current, state);
      },
    };
  }, []);
}
