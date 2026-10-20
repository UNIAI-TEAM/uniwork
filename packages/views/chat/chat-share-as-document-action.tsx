"use client";

import { useRef } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatDocumentShareLevel } from "@uniwork/core/api/endpoints/chat";
import { useShareChatMessageAsDocument } from "@uniwork/core/chat";
import { createSafeId } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { chatDocumentSendError } from "./chat-error-message";
import { bubbleControlClass } from "./chat-file-card";
import type { ChatMessage } from "./chat-messages";

const SHARE_LEVELS: readonly ChatDocumentShareLevel[] = ["view", "comment", "edit"];

/**
 * "Chia sẻ dạng tài liệu" on the sender's `kind:"file"` card: a level choice
 * (Chỉ xem, Nhận xét, Chỉnh sửa: the composer's own order) then one menu item
 * converts the attachment in place - the same message id comes back as kind
 * "document", so the row swaps cards without a second entry.
 */
export function ChatShareAsDocumentAction({
  workspaceId,
  roomId,
  message,
  isOwn,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  /** The bubble it sits on: a white wash on my brand bubble, the muted fill on theirs. */
  isOwn: boolean;
}) {
  const { t } = useTranslation();
  const share = useShareChatMessageAsDocument(workspaceId, roomId);
  // One key per user intent (a level on this message): a retried conversion
  // — including a retry after an error — replays under the same key instead
  // of linking a second document (contract §3.3 / L1). The server replays the
  // key's first answer whatever level a later call names, so the level rides
  // with the key and a different level mints a new one (RFC-201). The key is
  // released on success, and on a menu close with nothing in flight (the
  // intent is abandoned).
  const intent = useRef<{ key: string; level: ChatDocumentShareLevel } | null>(null);
  const inFlightRef = useRef(false);
  const run = (level: ChatDocumentShareLevel) => {
    if (share.isPending) return;
    const current =
      intent.current?.level === level ? intent.current : { key: createSafeId(), level };
    intent.current = current;
    // Selecting an item closes the menu in the same click, before isPending
    // repaints — the close handler reads this ref instead (RFC-06).
    inFlightRef.current = true;
    share.mutate(
      { messageId: message.id, share_level: level, client_msg_id: current.key },
      {
        onSuccess: () => {
          inFlightRef.current = false;
          intent.current = null;
        },
        onError: (err) => {
          inFlightRef.current = false;
          toast.error(chatDocumentSendError(err, t, t("chat.errors.internal")));
        },
      },
    );
  };
  return (
    <DropdownMenu
      onOpenChange={(next) => {
        // Closing the menu abandons the intent — unless the conversion is
        // still in flight, in which case the key must stay for the retry.
        if (!next && !inFlightRef.current) intent.current = null;
      }}
    >
      <DropdownMenuTrigger
        disabled={share.isPending}
        render={
          <Button
            type="button"
            variant="toolbar"
            size="sm"
            className={cn("pointer-coarse:min-h-11 gap-1.5 rounded-full px-3 font-semibold", bubbleControlClass(isOwn))}
            disabled={share.isPending}
          >
            {share.isPending ? <Spinner /> : <FileText aria-hidden className="size-4" />}
            {t("chat.document_share_as_document")}
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64" aria-label={t("chat.document_share_as_document")}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("chat.document_share_as_document")}</DropdownMenuLabel>
          {SHARE_LEVELS.map((level) => (
            <DropdownMenuItem key={level} className="pointer-coarse:min-h-11" onClick={() => run(level)}>
              {t(`documents.share.level_${level}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
