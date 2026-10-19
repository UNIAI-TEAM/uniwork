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
import { chatDocumentSendError } from "./chat-error-message";
import type { ChatMessage } from "./chat-messages";

const SHARE_LEVELS: readonly ChatDocumentShareLevel[] = ["comment", "view", "edit"];

/**
 * "Chia sẻ dạng tài liệu" on the sender's `kind:"file"` card: a level choice
 * (Nhận xét first, the composer's own order) then one menu item converts
 * the attachment in place - the same message id comes back as kind
 * "document", so the row swaps cards without a second entry.
 */
export function ChatShareAsDocumentAction({
  workspaceId,
  roomId,
  message,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
}) {
  const { t } = useTranslation();
  const share = useShareChatMessageAsDocument(workspaceId, roomId);
  // One key per user intent: a retried conversion — including a retry after
  // an error — replays under the same key instead of linking a second
  // document (contract §3.3 / L1). The key is released on success, and on a
  // menu close with nothing in flight (the intent is abandoned).
  const clientMsgId = useRef<string | null>(null);
  const inFlightRef = useRef(false);
  const run = (level: ChatDocumentShareLevel) => {
    if (share.isPending) return;
    clientMsgId.current ??= createSafeId();
    // Selecting an item closes the menu in the same click, before isPending
    // repaints — the close handler reads this ref instead (RFC-06).
    inFlightRef.current = true;
    share.mutate(
      { messageId: message.id, share_level: level, client_msg_id: clientMsgId.current },
      {
        onSuccess: () => {
          inFlightRef.current = false;
          clientMsgId.current = null;
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
        if (!next && !inFlightRef.current) clientMsgId.current = null;
      }}
    >
      <DropdownMenuTrigger
        disabled={share.isPending}
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-coarse:min-h-11 gap-1.5"
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
