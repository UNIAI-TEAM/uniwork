"use client";

import { ChevronLeft, MessageCircle, PanelLeft } from "lucide-react";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { CHAT_WALL } from "./chat-wall";

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
        variant="secondary"
        className="hidden h-10 rounded-full px-4 lg:inline-flex"
        aria-expanded={false}
        data-chat-sidebar-expand=""
        onClick={onShowList}
      >
        <PanelLeft aria-hidden />
        {t("chat.show_conversations")}
      </Button>
    ) : null;
  const back = onBackToList ? (
    <Button type="button" variant="secondary" className="h-10 rounded-full px-4 lg:hidden" onClick={onBackToList}>
      <ChevronLeft aria-hidden />
      {t("chat.back_to_conversations")}
    </Button>
  ) : null;

  // The wall the conversation opens on, with one card that says where to start.
  return (
    <div className={`flex flex-1 items-center justify-center p-6 ${CHAT_WALL}`}>
      <div className="flex w-full max-w-85 flex-col items-center rounded-2xl bg-surface px-6 pt-7 pb-6 text-center shadow-chat-bubble">
        <IconTile icon={MessageCircle} tone="brand" size="lg" className="mb-3 size-16 rounded-2xl [&_svg]:size-7" />
        <h2 className="font-display text-title font-bold text-foreground">
          {t("chat.no_conversation_title")}
        </h2>
        <p className="mt-1 max-w-73 text-body text-pretty text-muted-foreground">
          {listHidden ? t("chat.no_conversation_hint_hidden") : t("chat.no_conversation_hint")}
        </p>
        {showList || back ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {showList}
            {back}
          </div>
        ) : null}
      </div>
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
    <div className="hidden h-16 shrink-0 items-center border-b border-border bg-surface px-3 lg:flex">
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
