"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatRoomMemberPermissions } from "@uniwork/core/api/endpoints/chat";
import { useUpdateChatRoomSettings } from "@uniwork/core/chat";
import { Label } from "@uniwork/ui/components/ui/label";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { CHAT_SWITCH_CLASS } from "./chat-dialog-look";
import { toastChatError } from "./chat-error-message";
import { ChatSettingsNote } from "./chat-settings-ui";

const defaultPermissions = (): ChatRoomMemberPermissions => ({
  allow_change_profile: true,
  allow_pin_content: true,
  allow_create_notes: true,
  allow_create_polls: true,
  allow_send_messages: true,
});

type PermissionKey = keyof ChatRoomMemberPermissions;

const permissionKeys: PermissionKey[] = [
  "allow_change_profile",
  "allow_pin_content",
  "allow_create_notes",
  "allow_create_polls",
  "allow_send_messages",
];

export function ChatGroupManageSection({
  id,
  workspaceId,
  roomId,
  permissions,
  canManage,
}: {
  /** Lets the "Manage" toggle point at this section (aria-controls). */
  id?: string;
  workspaceId: string;
  roomId: string;
  permissions?: ChatRoomMemberPermissions | null;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const updateSettings = useUpdateChatRoomSettings(workspaceId);
  const current = { ...defaultPermissions(), ...permissions };

  const toggle = (key: PermissionKey, checked: boolean) => {
    if (!canManage || updateSettings.isPending) return;
    void updateSettings
      .mutateAsync({
        roomId,
        member_permissions: { [key]: checked },
      })
      .then(() => {
        toast.success(t("chat.settings_permissions_saved"));
      })
      .catch((err: unknown) => {
        toastChatError(err, t, t("chat.settings_permissions_save_failed"));
      });
  };

  // Each permission applies the moment it is flipped, so it is a switch, not
  // a checkbox waiting for a Save that does not exist.
  return (
    <section id={id} className="border-t-8 border-muted px-5 pt-3.5 pb-4">
      <p className="mb-1 text-body font-semibold text-foreground">{t("chat.settings_group_permissions_title")}</p>
      <ul className="divide-y divide-border">
        {permissionKeys.map((key) => (
          <li key={key} className="flex min-h-13 items-center justify-between gap-4 py-1.5">
            <Label
              htmlFor={`chat-perm-${roomId}-${key}`}
              className="flex-1 cursor-pointer text-body-lg leading-snug font-normal text-foreground"
            >
              {t(`chat.settings_perm_${key}`)}
            </Label>
            <Switch
              id={`chat-perm-${roomId}-${key}`}
              checked={current[key]}
              disabled={!canManage || updateSettings.isPending}
              onCheckedChange={(value) => toggle(key, value === true)}
              className={CHAT_SWITCH_CLASS}
            />
          </li>
        ))}
      </ul>
      {!canManage ? (
        <ChatSettingsNote className="mt-2.5">{t("chat.settings_permissions_admin_only")}</ChatSettingsNote>
      ) : null}
    </section>
  );
}

export { defaultPermissions as defaultChatRoomMemberPermissions };
