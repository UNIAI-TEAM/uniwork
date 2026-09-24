"use client";

import { ChevronLeft, MessageSquare, PanelLeft } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { CollectionPageState } from "../layout/collection-page";
import { moduleTone } from "../layout/module-tones";

/**
 * Main pane when no conversation is open: say so, and where to start. When
 * the list is hidden (collapsed on a wide screen, or swapped out on a phone)
 * the pane itself offers the way back to it, and the copy does not point at
 * a list that is not there.
 */
export function ChatPageEmptyConversation({
  t,
  listHidden = false,
  onShowList,
  onBackToList,
}: {
  t: (key: string) => string;
  /** The list is collapsed on a wide screen. */
  listHidden?: boolean;
  onShowList?: () => void;
  /** Phones only: back to the conversation list. */
  onBackToList?: () => void;
}) {
  const showList =
    listHidden && onShowList ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="hidden lg:inline-flex"
        aria-expanded={false}
        data-chat-sidebar-expand=""
        onClick={onShowList}
      >
        <PanelLeft aria-hidden />
        {t("chat.show_conversations")}
      </Button>
    ) : null;
  const back = onBackToList ? (
    <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={onBackToList}>
      <ChevronLeft aria-hidden />
      {t("chat.back_to_conversations")}
    </Button>
  ) : null;

  return (
    <div className="flex flex-1 items-center justify-center">
      <CollectionPageState
        icon={MessageSquare}
        tone={moduleTone("chat")}
        title={t("chat.no_conversation_title")}
        description={listHidden ? t("chat.no_conversation_hint_hidden") : t("chat.no_conversation_hint")}
        actions={
          showList || back ? (
            <>
              {showList}
              {back}
            </>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * "Show list" for the conversation frame when the toolbar that normally
 * carries it is not there (loading, no room, search open): the way back to a
 * collapsed list must not depend on a room being open.
 */
export function ChatFrameListToggle({ t, onShowList }: { t: (key: string) => string; onShowList: () => void }) {
  return (
    <div className="hidden h-14 shrink-0 items-center border-b border-border bg-surface px-3 lg:flex">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="text-muted-foreground hover:text-foreground"
        aria-label={t("chat.show_conversations")}
        aria-expanded={false}
        data-chat-sidebar-expand=""
        onClick={onShowList}
      >
        <PanelLeft aria-hidden className="size-4.5" />
      </Button>
    </div>
  );
}
