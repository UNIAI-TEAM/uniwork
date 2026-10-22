"use client";

import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@uniwork/ui/components/ui/sheet";
import { CHAT_SHEET_CLASS } from "./chat-dialog-look";
import { ChatSettingsHeader } from "./chat-settings-ui";
import { ChatWallpaperPicker } from "./chat-wallpaper-picker";

/** Per-conversation wallpaper picker from the in-chat settings sheet. */
export function ChatWallpaperSheet({
  open,
  onOpenChange,
  roomId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roomId: string;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.preferences" });
  const { t: tChat } = useTranslation();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} closeLabel={tChat("common.close")} className={CHAT_SHEET_CLASS}>
        <SheetHeader className="sr-only">
          <SheetTitle>{t("chatWallpaper")}</SheetTitle>
          <SheetDescription>{t("chatWallpaperPerRoomHint")}</SheetDescription>
        </SheetHeader>
        <ChatSettingsHeader title={t("chatWallpaper")} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <ChatWallpaperPicker roomId={roomId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
