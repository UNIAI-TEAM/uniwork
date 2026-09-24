"use client";

import { useTranslation } from "react-i18next";
import type { Agent, Member } from "@uniwork/core/types";
import { TaskActorAvatar } from "./task-actor-avatar";

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TaskDetailMetadata({
  creatorId,
  creatorKind,
  members,
  agents,
  createdAt,
  updatedAt,
}: {
  creatorId: string;
  creatorKind?: string;
  members?: Member[];
  agents?: Agent[];
  createdAt?: string;
  updatedAt?: string;
}) {
  const { t } = useTranslation();
  const creator =
    creatorKind === "agent"
      ? agents?.find((agent) => agent.id === creatorId)
      : members?.find((member) => member.user_id === creatorId);
  const creatorName =
    creator && "name" in creator
      ? creator.name
      : creator?.display_name || (creator && "email" in creator ? creator.email : creatorId);
  const creatorAvatarUrl =
    creator && typeof creator.avatar_url === "string" ? creator.avatar_url : undefined;

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h2 className="mb-2 text-caption font-medium text-muted-foreground">
        {t("tasks.detail.section_details")}
      </h2>
      <dl className="space-y-2 text-caption">
        <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
          <dt className="text-muted-foreground">{t("tasks.detail.creator")}</dt>
          <dd className="flex min-w-0 items-center gap-2 text-foreground">
            <TaskActorAvatar
              name={creatorName}
              avatarUrl={creatorAvatarUrl}
              kind={creatorKind}
            />
            <span className="truncate">{creatorName}</span>
          </dd>
        </div>
        {[
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
