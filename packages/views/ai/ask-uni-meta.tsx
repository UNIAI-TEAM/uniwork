"use client";

import { useTranslation } from "react-i18next";
import { useAuthStore } from "@uniwork/core/auth";
import { formatMessageTime } from "../chat/chat-message-time";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Who wrote a turn and when: "HH:mm", with the date added when it was not today. An unreadable time is left out. */
export function AskUniMessageMeta({ role, createdAt }: { role: "user" | "assistant"; createdAt: string }) {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "ai" });
  const name = useAuthStore((s) => s.user?.display_name) ?? t("you");
  const at = createdAt ? new Date(createdAt) : null;
  const valid = at !== null && !Number.isNaN(at.getTime());
  let time = "";
  if (valid) {
    time = formatMessageTime(at.getTime(), i18n.language);
    if (!sameDay(at, new Date())) time = `${at.toLocaleDateString(i18n.language, { day: "numeric", month: "numeric" })} ${time}`;
  }
  const who = role === "user" ? name : t("meta.uni");
  return (
    <p className="text-caption text-muted-foreground">
      {who}
      {time ? ` · ${time}` : ""}
    </p>
  );
}
