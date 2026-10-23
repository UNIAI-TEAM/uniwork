"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runtimeConfig } from "@uniwork/core/runtime-config";

export type OAuthPopupOutcome =
  | { kind: "blocked" }
  | { kind: "failed" }
  | { kind: "closed" }
  | { kind: "message"; ok: boolean; code: string };

const POPUP_FEATURES = "popup,width=560,height=720";
const CLOSED_POLL_MS = 400;

/**
 * Runs one OAuth sign-in in a popup. Call open() from the click handler: the
 * window opens synchronously on about:blank so popup blockers let it through,
 * and only then is the authorization URL awaited. Each accepted open() reports
 * exactly one outcome, and nothing is reported after unmount.
 */
export function useOAuthPopup({
  name,
  messageType,
  onOutcome,
}: {
  name: string;
  messageType?: string;
  onOutcome: (outcome: OAuthPopupOutcome) => void;
}): {
  open: (start: () => Promise<string | null | undefined>) => void;
  pending: boolean;
  /** Brings the open popup back to the front; does nothing when none is open. */
  focus: () => void;
} {
  const [pending, setPending] = useState(false);
  const onOutcomeRef = useRef(onOutcome);
  onOutcomeRef.current = onOutcome;
  const stopRef = useRef<(() => void) | null>(null);
  const windowRef = useRef<Window | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  const open = useCallback(
    (start: () => Promise<string | null | undefined>) => {
      // One popup at a time: the window name is shared, so a second open would retarget the first.
      if (stopRef.current) return;
      const popup = window.open("about:blank", name, POPUP_FEATURES);
      if (!popup) {
        onOutcomeRef.current({ kind: "blocked" });
        return;
      }
      let done = false;
      let timer: number | undefined;
      let onMessage: ((event: MessageEvent) => void) | undefined;
      const stop = () => {
        done = true;
        stopRef.current = null;
        windowRef.current = null;
        window.clearInterval(timer);
        if (onMessage) window.removeEventListener("message", onMessage);
      };
      const finish = (outcome: OAuthPopupOutcome) => {
        if (done) return;
        stop();
        setPending(false);
        onOutcomeRef.current(outcome);
      };
      stopRef.current = stop;
      windowRef.current = popup;
      setPending(true);
      void (async () => {
        let url: string | null | undefined;
        try {
          url = await start();
        } catch {
          url = null;
        }
        if (done) {
          // Unmounted while the URL was on its way: leave no orphan window.
          popup.close();
          return;
        }
        if (!url) {
          popup.close();
          finish({ kind: "failed" });
          return;
        }
        popup.location.href = url;
        if (messageType) {
          // A relative apiUrl (same-origin proxy) resolves against the page instead of throwing.
          const origin = new URL(runtimeConfig().apiUrl, document.baseURI).origin;
          onMessage = (event: MessageEvent) => {
            if (event.origin !== origin || event.source !== popup) return;
            const data: unknown = event.data;
            if (typeof data !== "object" || data === null) return;
            const { type, ok, code } = data as Record<string, unknown>;
            if (type !== messageType || typeof code !== "string") return;
            finish({ kind: "message", ok: ok === true, code });
          };
          window.addEventListener("message", onMessage);
        }
        timer = window.setInterval(() => {
          if (popup.closed) finish({ kind: "closed" });
        }, CLOSED_POLL_MS);
      })();
    },
    [name, messageType],
  );

  const focus = useCallback(() => windowRef.current?.focus(), []);

  return { open, pending, focus };
}
