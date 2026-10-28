"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { readUnsentRecordings, type RecordingPart } from "@uniwork/core/meetings/recorder";
import { ConfirmDialog } from "../common/form-dialog";

/** How long signing out waits on the device before it goes ahead without asking. */
const READ_BUDGET_MS = 1_500;

/**
 * Signing out with meeting recordings still on this device asks first (UNI-2247): they stay
 * there, and only this account can send them, after signing in again. Every part counts, a
 * part another tab is still writing too. The device is read only when the person signs out,
 * and a read that fails or hangs (WebKit can stall `indexedDB.open`) never stops them.
 * Render `dialog` beside the control that signs out.
 */
export function useLogoutUnsentGuard(userId: string | undefined): {
  confirmLogout: (logout: () => Promise<void>) => void;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const [held, setHeld] = useState<(() => Promise<void>) | null>(null);
  // Kept after the question closes, so its exit animation does not read "Còn 0".
  const [count, setCount] = useState(0);
  const confirmLogout = (logout: () => Promise<void>) => {
    if (userId === undefined) return void logout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<RecordingPart[]>((resolve) => {
      timer = setTimeout(() => resolve([]), READ_BUDGET_MS);
    });
    void Promise.race([readUnsentRecordings(userId), budget])
      .catch((): RecordingPart[] => [])
      .then((parts) => {
        clearTimeout(timer);
        // One recording per meeting, however many parts it was saved in.
        const meetings = new Set(parts.map((p) => p.meetingId)).size;
        if (meetings === 0) return logout();
        setCount(meetings);
        setHeld(() => logout);
      });
  };
  const dialog = (
    <ConfirmDialog
      open={held !== null}
      onOpenChange={(open) => {
        if (!open) setHeld(null);
      }}
      title={t("meetings.record.logoutTitle", { count })}
      description={t("meetings.record.logoutBody")}
      confirmLabel={t("meetings.record.logoutAnyway")}
      cancelLabel={t("meetings.record.stay")}
      destructive={false}
      onConfirm={() => {
        const go = held;
        setHeld(null);
        void go?.();
      }}
    />
  );
  return { confirmLogout, dialog };
}
