"use client";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * People added to the meeting after the roll was finalized. They have no mark
 * in the snapshot, so they sit apart from it and say why they are not counted.
 */
export function MeetingAttendanceAddedLater({ count, children }: { count: number; children: ReactNode }) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-1">
      <p id={headingId} className="px-1 text-label text-muted-foreground">
        {t("meetings.governance.addedAfterFinalize", { count })}
      </p>
      <p className="px-1 text-caption text-muted-foreground">{t("meetings.governance.addedAfterFinalizeHint")}</p>
      <ul className="-mx-2 divide-y divide-border">{children}</ul>
    </section>
  );
}
