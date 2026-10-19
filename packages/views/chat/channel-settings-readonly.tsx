"use client";

import { Globe, Lock, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { ChatSettingsNote, ChatSettingsSection } from "./chat-settings-ui";

/**
 * What a channel member who is not its admin sees instead of the edit form:
 * the same facts as plain values, and one line on who can change them — the
 * server refuses the edit anyway, so the sheet does not offer it.
 */
export function ChannelSettingsReadonly({
  channel,
  projectTitle,
}: {
  channel: ChatRoomRecord;
  projectTitle: string | null;
}) {
  const { t } = useTranslation();
  const visibility = channel.visibility === "private" ? "private" : "public";
  const topic = channel.topic?.trim();
  const rows: { key: string; label: string; value: string; muted?: boolean; icon?: LucideIcon; note?: string }[] = [
    { key: "name", label: t("chat.channel.name_label"), value: channel.name },
    {
      key: "topic",
      label: t("chat.channel.topic_label"),
      value: topic || t("chat.channel.topic_empty"),
      muted: !topic,
    },
    {
      key: "visibility",
      label: t("chat.channel.visibility_label"),
      value: t(`chat.channel.visibility_${visibility}_title`),
      icon: visibility === "private" ? Lock : Globe,
      note: channel.is_default ? t("chat.channel.default_visibility_locked") : undefined,
    },
    {
      key: "project",
      label: t("chat.channel.project_label"),
      value: projectTitle || t("chat.channel.project_none"),
      muted: !projectTitle,
    },
  ];

  return (
    <ChatSettingsSection className="px-5 pt-2 pb-5">
      <dl className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.key} className="space-y-0.5 py-3">
            <dt className="text-caption text-muted-foreground">{row.label}</dt>
            <dd
              className={row.muted ? "text-body-lg text-muted-foreground" : "text-body-lg text-pretty text-foreground"}
            >
              {row.icon ? (
                <span className="flex items-center gap-1.5">
                  <row.icon className="size-4 shrink-0" aria-hidden />
                  {row.value}
                </span>
              ) : (
                row.value
              )}
              {row.note ? <span className="mt-0.5 block text-caption text-muted-foreground">{row.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <ChatSettingsNote className="mt-2">{t("chat.channel.settings_admin_only")}</ChatSettingsNote>
    </ChatSettingsSection>
  );
}
