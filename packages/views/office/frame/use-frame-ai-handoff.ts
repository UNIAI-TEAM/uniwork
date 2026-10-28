"use client";

import { useMemo, useRef } from "react";
import { useOfficeHandoffStore } from "@uniwork/core/ai/office-handoff";
import type { DocsFrameHost } from "@uniwork/core/office/docs-frame-host";
import type { InitAck } from "@uniwork/core/office/docs-frame-protocol";

/** What the frame session needs to hand Ask UNI's approved job to the editor AI (UNI-2264). */
export interface FrameAiHandoffBinding {
  /** A handshake completed: the frame's capabilities are known. */
  attach(host: DocsFrameHost, ack: InitAck): void;
  /** The host answered the frame's `api.open`: the editor has its document. */
  documentOpened(): void;
  /** The frame endpoint is gone (retry, unmount). */
  detach(): void;
  /** The frame's AI started or finished a turn. */
  onAiRun(state: "running" | "idle"): void;
}

/**
 * Sends the queued job once, after the handshake AND the document open of the same frame instance.
 * The store entry is consumed by `take`, so a remount, a retry or a second open sends nothing twice.
 */
export function useFrameAiHandoff(documentId: string): FrameAiHandoffBinding {
  const idRef = useRef(documentId);
  idRef.current = documentId;
  return useMemo(() => {
    let host: DocsFrameHost | null = null;
    let ack: InitAck | null = null;
    let opened = false;

    const start = () => {
      if (!host || !ack || !opened) return;
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
          // A run event can beat the answer; only the state `take` left reads as "sent".
          if (now.byDocument[id]?.status === "sent") now.setStatus(id, "sent");
        },
        () => { useOfficeHandoffStore.getState().setStatus(id, "refused"); },
      );
    };

    return {
      attach(nextHost, nextAck) {
        host = nextHost;
        ack = nextAck;
        opened = false;
      },
      documentOpened() {
        opened = true;
        start();
      },
      detach() {
        host = null;
        ack = null;
        opened = false;
      },
      onAiRun(state) {
        useOfficeHandoffStore.getState().setStatus(idRef.current, state);
      },
    };
  }, []);
}
