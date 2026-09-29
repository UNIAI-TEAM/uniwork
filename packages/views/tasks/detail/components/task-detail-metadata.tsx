"use client";

import { useTranslation } from "react-i18next";
import type { Agent, Member } from "@uniwork/core/types";
import { shortDateFormat } from "../../../common/date-pill";
import { PropRow } from "../../../common/prop-row";
import { SidebarSection } from "../../../common/sidebar-section";
import { TaskActorAvatar } from "./task-actor-avatar";

function formatDate(value: string | undefined, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, shortDateFormat(String(date.getFullYear())));
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
  const { t, i18n } = useTranslation();
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
    <SidebarSection title={t("tasks.detail.section_details")}>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">
        <PropRow label={t("tasks.detail.creator")} interactive={false}>
          <TaskActorAvatar name={creatorName} avatarUrl={creatorAvatarUrl} kind={creatorKind} />
          <span className="truncate">{creatorName}</span>
        </PropRow>
        <PropRow label={t("tasks.detail.created_at")} interactive={false}>
          <span className="truncate">{formatDate(createdAt, i18n.language)}</span>
        </PropRow>
        <PropRow label={t("tasks.detail.updated_at")} interactive={false}>
          <span className="truncate">{formatDate(updatedAt, i18n.language)}</span>
        </PropRow>
      </div>
    </SidebarSection>
  );
}
