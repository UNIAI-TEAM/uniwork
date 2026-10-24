// Keeps a chat message push's buttons (data/chat-notification-actions.ts) in
// step with the app's language and with the app lock as carried out: the
// person's choice raised to the organization's floor (privacy.ts ›
// usePrivacySettings, which privacy-floor-sync.tsx feeds). While the lock is
// on there is no Reply; turning the lock on or off, here or by the
// organization, registers the category again. Nothing is registered until the
// saved choices are read: the category of the last launch stays meanwhile.
// Mounted once at the root (app/_layout.tsx), beside the floor sync.
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { registerChatMessageCategory } from "@/data/chat-notification-actions";
import { notificationActionsLocked } from "@/lib/app-lock";
import { usePrivacySettings } from "./privacy";

export function ChatCategorySync(): null {
  const { t, i18n } = useTranslation();
  const privacy = usePrivacySettings();
  const locked = notificationActionsLocked(privacy);

  useEffect(() => {
    if (locked === null) return;
    void registerChatMessageCategory(t, Platform.OS, locked);
  }, [t, i18n.language, locked]);

  return null;
}
