"use client";

import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";

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
  const rows: { key: string; label: string; value: string; muted?: boolean }[] = [
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
    },
    {
      key: "project",
      label: t("chat.channel.project_label"),
      value: projectTitle || t("chat.channel.project_none"),
      muted: !projectTitle,
    },
  ];

  return (
    <section className="space-y-3 border-b border-border px-4 py-4">
      <dl className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="space-y-0.5">
            <dt className="text-caption text-muted-foreground">{row.label}</dt>
            <dd className={row.muted ? "text-body text-muted-foreground" : "text-body text-foreground text-pretty"}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-muted-foreground">{t("chat.channel.settings_admin_only")}</p>
    </section>
  );
}
