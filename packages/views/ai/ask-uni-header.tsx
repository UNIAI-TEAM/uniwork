"use client";

import { MessageSquarePlus, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiConversations, useAiPanelStore } from "@uniwork/core/ai";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniHistory } from "./ask-uni-history";

function HeaderAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={label} onClick={onClick} />
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
  const conversations = useAiConversations(workspace.id);
  const { conversationId, select, setOpen } = useAiPanelStore();
  const current = conversations.data?.find((c) => c.id === conversationId);
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
      <Sparkles aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <AskUniHistory title={current?.title || t("untitled")} />
      </div>
      <HeaderAction label={t("new_conversation")} onClick={() => select(null)}>
        <MessageSquarePlus aria-hidden />
      </HeaderAction>
      <HeaderAction label={t("close")} onClick={() => setOpen(false)}>
        <X aria-hidden />
      </HeaderAction>
    </div>
  );
}
