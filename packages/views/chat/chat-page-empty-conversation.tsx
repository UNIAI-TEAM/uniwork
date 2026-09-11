"use client";

import { MessageSquare } from "lucide-react";

/** Empty main pane when no conversation is selected. */
export function ChatPageEmptyConversation({
  t,
}: {
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <MessageSquare className="size-8" aria-hidden />
      </span>
      <p className="text-body font-medium text-foreground">{t("chat.contacts_title")}</p>
      <p className="max-w-sm text-caption text-muted-foreground">{t("chat.contacts_hint")}</p>
    </div>
  );
}
