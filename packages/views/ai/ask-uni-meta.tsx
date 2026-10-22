"use client";

import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { formatMessageTime } from "../chat/chat-message-time";
import { AskUniProviderMark, type AskLook } from "./ask-uni-provider";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * Who wrote a turn and when: "HH:mm", with the date added when it was not today. An unreadable time is left out. An
 * answer names the model the asker chose beside its mark, and UNI with UNI's mark for Auto.
 */
export function AskUniMessageMeta({
  from,
  createdAt,
  model = "",
  look = null,
}: {
  from: "user" | "assistant";
  createdAt: string;
  model?: string;
  look?: AskLook | null;
}) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai" });
  const name = useAuthStore((s) => s.user?.display_name) ?? t("you");
  const at = createdAt ? new Date(createdAt) : null;
  const valid = at !== null && !Number.isNaN(at.getTime());
  let time = "";
  if (valid) {
    time = formatMessageTime(at.getTime(), i18n.language);
    if (!sameDay(at, new Date())) time = `${at.toLocaleDateString(i18n.language, { day: "numeric", month: "numeric" })} ${time}`;
  }
  if (from === "user") {
    return (
      <p className="text-caption text-muted-foreground">
        {name}
        {time ? ` · ${time}` : ""}
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
      <AskUniProviderMark look={model ? look : null} size={14} />
      <span>
        <span className="font-medium text-foreground">{model ? t(`models.${model}.name`, { defaultValue: model }) : t("meta.uni")}</span>
        {time ? ` · ${time}` : ""}
      </span>
    </p>
  );
}
