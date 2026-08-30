"use client";

import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { ChatConversationToolbar } from "./group-settings-sheet";
import { LeaveConversationSection } from "./leave-conversation-section";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function DmSettingsSheet({
  open,
  onOpenChange,
  contact,
  youLabel,
  onLeave,
  leaving,
  leaveDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ChatContact;
  youLabel: string;
  onLeave: () => void | Promise<void>;
  leaving?: boolean;
  leaveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const contactLabel = displayLabelForChatContact(contact);

  const participants = [
    { key: "self", label: youLabel, email: undefined as string | undefined },
    { key: contact.user_id, label: contactLabel, email: contact.email || undefined },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{contactLabel}</SheetTitle>
          <SheetDescription>{t("chat.dm_settings_description")}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-label font-medium text-foreground">{t("chat.dm_participants_title")}</h2>
            <span className="text-caption text-muted-foreground">
              {t("chat.group_member_count", { count: participants.length })}
            </span>
          </div>

          <ul className="space-y-2">
            {participants.map((participant) => (
              <li
                key={participant.key}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <ActorAvatar
                  name={participant.label}
                  initials={initialOf(participant.label)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">{participant.label}</p>
                  {participant.email ? (
                    <p className="truncate text-caption text-muted-foreground">{participant.email}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          <LeaveConversationSection
            variant="dm"
            disabled={leaveDisabled}
            leaving={leaving}
            onLeave={onLeave}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DmChatToolbar({
  contact,
  onOpenSettings,
  onVoiceCall,
  voiceCallDisabled,
}: {
  contact: ChatContact;
  onOpenSettings: () => void;
  onVoiceCall?: () => void;
  voiceCallDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const contactLabel = displayLabelForChatContact(contact);

  return (
    <ChatConversationToolbar
      title={contactLabel}
      subtitle={contact.email || t("chat.dm_direct_message")}
      settingsAriaLabel={t("chat.dm_settings")}
      voiceCallAriaLabel={t("chat.voice_call_start")}
      onVoiceCall={onVoiceCall}
      voiceCallDisabled={voiceCallDisabled}
      onOpenSettings={onOpenSettings}
    />
  );
}
