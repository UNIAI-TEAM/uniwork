"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useUnsentRecordings } from "@uniwork/core/meetings/recorder";
import { ConfirmDialog } from "../common/form-dialog";

/**
 * Signing out with meeting recordings still on this device asks first (UNI-2247): they stay
 * there, and only this account can send them, after signing in again. Every part counts, a
 * part another tab is still writing too. Render `dialog` beside the control that signs out.
 */
export function useLogoutUnsentGuard(userId: string | undefined): {
  confirmLogout: (logout: () => Promise<void>) => void;
  dialog: ReactNode;
} {
  const { t } = useTranslation();
  const { parts, refresh } = useUnsentRecordings(userId);
  const [held, setHeld] = useState<(() => Promise<void>) | null>(null);
  // One recording per meeting, however many parts it was saved in.
  const count = new Set(parts.map((p) => p.meetingId)).size;
  const confirmLogout = (logout: () => Promise<void>) => {
    // Read the device afresh: this control may have been mounted since before the recording.
    // A device that cannot be read never blocks signing out.
    void refresh().then(
      (now) => (now.length > 0 ? setHeld(() => logout) : logout()),
      () => logout(),
    );
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
        const logout = held;
        setHeld(null);
        void logout?.();
      }}
    />
  );
  return { confirmLogout, dialog };
}
