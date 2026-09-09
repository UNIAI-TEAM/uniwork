"use client";

import { useTranslation } from "react-i18next";

/** Task 9 fills this with real attachment list / upload. */
export function TaskDetailAttachmentsSlot() {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t("tasks.detail.attachments_section")}
      className="mt-6"
    >
      <h2 className="mb-2 text-body font-semibold text-foreground">
        {t("tasks.detail.attachments_section")}
      </h2>
      <p className="text-caption text-muted-foreground">
        {t("tasks.detail.attachments_placeholder")}
      </p>
    </section>
  );
}
