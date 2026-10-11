"use client";

import { useCallback } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * Senders whose remote images load without asking, kept per mailbox (a mailbox
 * belongs to one person, so two people on one device never share the list).
 * It lives on this device through the StorageAdapter, never localStorage.
 * shortcut: a From address can be forged, so whoever spoofs a trusted address
 * gets their pixels loaded; the server-side image proxy (UNI-1235) removes that.
 */
interface EmailHubTrustedSendersState {
  senders: Record<string, string[]>;
  setTrusted: (accountId: string, address: string, trusted: boolean) => void;
}

const EMPTY: string[] = [];

function normalize(address: string) {
  return address.trim().toLowerCase();
}

export const useEmailHubTrustedSendersStore = create<EmailHubTrustedSendersState>()(
  persist(
    (set) => ({
      senders: {},
      setTrusted: (accountId, address, trusted) => {
        const addr = normalize(address);
        if (!accountId || !addr) return;
        set((state) => {
          const current = state.senders[accountId] ?? EMPTY;
          if (trusted === current.includes(addr)) return state;
          const next = trusted ? [...current, addr] : current.filter((a) => a !== addr);
          const senders = { ...state.senders };
          if (next.length) senders[accountId] = next;
          else delete senders[accountId];
          return { senders };
        });
      },
    }),
    {
      name: "uniwork_email_hub_trusted_senders",
      storage: createJSONStorage(() => defaultStorage),
      version: 1,
      partialize: (state) => ({ senders: state.senders }),
    },
  ),
);

/** Whether `address` is trusted for this mailbox, plus a setter. */
export function useEmailHubSenderTrust(
  accountId: string,
  address: string,
): [boolean, (trusted: boolean) => void] {
  const addr = normalize(address);
  const trusted = useEmailHubTrustedSendersStore(
    (state) => !!addr && (state.senders[accountId] ?? EMPTY).includes(addr),
  );
  const setTrusted = useEmailHubTrustedSendersStore((state) => state.setTrusted);
  const set = useCallback((next: boolean) => setTrusted(accountId, addr, next), [accountId, addr, setTrusted]);
  return [trusted, set];
}

/** The trusted senders of one mailbox, oldest first. */
export function useEmailHubTrustedSenders(accountId: string): string[] {
  return useEmailHubTrustedSendersStore((state) => state.senders[accountId] ?? EMPTY);
}
