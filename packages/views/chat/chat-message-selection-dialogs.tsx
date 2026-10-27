"use client";

import { Trash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { CHAT_CONFIRM_CLASS } from "./chat-confirm-look";
import { ChatForwardDialog } from "./chat-forward-dialog";
import type { ChatMessage } from "./chat-messages";

/** Forward + delete confirms for a multi-select selection. */
export function ChatMessageSelectionDialogs({
  workspaceId,
  forwardingMessages,
  onForwardOpenChange,
  onForwarded,
  deletingSelected,
  onDeletingOpenChange,
  onConfirmDelete,
  deletePending,
}: {
  workspaceId: string;
  forwardingMessages: ChatMessage[] | null;
  onForwardOpenChange: (open: boolean) => void;
  onForwarded: () => void;
  deletingSelected: ChatMessage[] | null;
  onDeletingOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  deletePending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ChatForwardDialog
        workspaceId={workspaceId}
        messages={forwardingMessages}
        onOpenChange={onForwardOpenChange}
        onForwarded={onForwarded}
      />
      <AlertDialog open={deletingSelected != null} onOpenChange={onDeletingOpenChange}>
        <AlertDialogContent className={cn(CHAT_CONFIRM_CLASS, "sm:max-w-100")}>
          <AlertDialogHeader>
            <IconTile icon={Trash} tone="destructive" className="mb-2.5" />
            <AlertDialogTitle>{t("chat.selection.delete_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chat.selection.delete_confirm_description", { count: deletingSelected?.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="secondary" aria-disabled={deletePending || undefined}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructiveSolid"
              aria-disabled={deletePending || undefined}
              aria-busy={deletePending || undefined}
              onClick={onConfirmDelete}
            >
              {deletePending ? <Spinner data-icon="inline-start" /> : null}
              {t("chat.selection.delete_selected")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
