"use client";

import { MessageSquare } from "lucide-react";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";

/** Main pane when no conversation is open: say so, and where to start. */
export function ChatPageEmptyConversation({
  t,
}: {
  t: (key: string) => string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <CollectionPageState
        icon={MessageSquare}
        tone={moduleTone("chat")}
        title={t("chat.no_conversation_title")}
        description={t("chat.no_conversation_hint")}
      />
    </div>
  );
}
