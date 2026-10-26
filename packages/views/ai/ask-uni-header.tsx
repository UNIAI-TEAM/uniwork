"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Brain, MessageSquarePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { aiKeys, useAiCapabilities, useAiConversations, useAiPanelStore } from "@uniwork/core/ai";
import type { AiConversation } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniHistory } from "./ask-uni-history";

function HeaderAction({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** One line: UNI mark, the conversation title (opens the history), new, close. */
export function AskUniHeader() {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  const conversations = useAiConversations(workspace.id);
  const { conversationId, select, setOpen, setView, view } = useAiPanelStore();
  const memory = useAiCapabilities(workspace.id).data?.memory.enabled === true;
  // A conversation opened from search results may be in no recent list: every cached list of this workspace counts.
  const current =
    conversations.data?.find((c) => c.id === conversationId) ??
    qc
      .getQueriesData<AiConversation[]>({ queryKey: aiKeys.conversations(workspace.id) })
      .flatMap(([, list]) => list ?? [])
      .find((c) => c.id === conversationId);
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <AskUniHistory title={current?.title || t("untitled")} />
      </div>
      {memory ? (
        view === "memory" ? (
          // Open, the button reads its name, like ClickUp's "Memory", and a second press goes back to the conversation.
          <Button type="button" variant="secondary" size="sm" aria-pressed onClick={() => setView("thread")}>
            <Brain aria-hidden />
            {t("memory.button")}
          </Button>
        ) : (
          <HeaderAction label={t("memory.button")} pressed={false} onClick={() => setView("memory")}>
            <Brain aria-hidden />
          </HeaderAction>
        )
      ) : null}
      <HeaderAction label={t("new_conversation")} onClick={() => select(null)}>
        <MessageSquarePlus aria-hidden />
      </HeaderAction>
      <HeaderAction label={t("close")} onClick={() => setOpen(false)}>
        <X aria-hidden />
      </HeaderAction>
    </div>
  );
}
