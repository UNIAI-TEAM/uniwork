"use client";

import { useTranslation } from "react-i18next";

/** Task 8 fills this with comments, reactions, and agent/PR stubs. */
export function TaskDetailTimelineSlot() {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("tasks.detail.timeline_section")}
      className="mt-8 border-t border-border pt-6"
    >
      <h2 className="mb-2 text-body font-semibold text-foreground">
        {t("tasks.detail.timeline_section")}
      </h2>
      <p className="text-caption text-muted-foreground">
        {t("tasks.detail.timeline_placeholder")}
      </p>
    </section>
  );
}
