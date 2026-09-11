"use client";

import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ChatRoomMemberPermissions } from "@uniwork/core/api/endpoints/chat";
import { useUpdateChatRoomSettings } from "@uniwork/core/chat";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { Label } from "@uniwork/ui/components/ui/label";

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
  workspaceId,
  roomId,
  permissions,
  canManage,
}: {
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
        toast.info(t("chat.settings_permissions_saved"));
      })
      .catch(() => {
        toast.error(t("chat.settings_permissions_save_failed"));
      });
  };

  return (
    <section className="border-b border-border px-4 py-4">
      <p className="mb-3 text-body font-semibold text-foreground">
        {t("chat.settings_group_permissions_title")}
      </p>
      <ul className="space-y-3">
        {permissionKeys.map((key) => (
          <li key={key} className="flex items-start gap-3">
            <Checkbox
              id={`chat-perm-${roomId}-${key}`}
              checked={current[key]}
              disabled={!canManage || updateSettings.isPending}
              onCheckedChange={(value) => toggle(key, value === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor={`chat-perm-${roomId}-${key}`}
              className="flex-1 cursor-pointer text-body leading-snug text-foreground"
            >
              {t(`chat.settings_perm_${key}`)}
            </Label>
          </li>
        ))}
      </ul>
    </section>
  );
}

export { defaultPermissions as defaultChatRoomMemberPermissions };
