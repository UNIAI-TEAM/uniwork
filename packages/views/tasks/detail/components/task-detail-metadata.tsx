"use client";

import { useTranslation } from "react-i18next";

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TaskDetailMetadata({
  creatorName,
  createdAt,
  updatedAt,
}: {
  creatorName: string;
  createdAt?: string;
  updatedAt?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-5 border-t border-border pt-4">
      <h2 className="mb-2 text-caption font-medium text-muted-foreground">
        {t("tasks.detail.section_details")}
      </h2>
      <dl className="space-y-2 text-caption">
        {[
          [t("tasks.detail.creator"), creatorName],
          [t("tasks.detail.created_at"), formatDate(createdAt)],
          [t("tasks.detail.updated_at"), formatDate(updatedAt)],
        ].map(([label, value]) => (
          <div key={label} className="grid grid-cols-[7rem_1fr] gap-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
