"use client";

import { useRef, type ReactNode } from "react";
import { Camera, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorCode } from "@uniwork/core/api";
import { useSetChatRoomAvatar } from "@uniwork/core/chat";
import type { Tint } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toastChatError } from "./chat-error-message";
import { ChatSettingsRoomMark } from "./chat-settings-ui";

type TFunction = ReturnType<typeof useTranslation>["t"];

/** Mirrors server/internal/handler/chat_room_avatar.go: the sniffed types and maxChatRoomAvatarBytes (2 MiB). */
const GROUP_AVATAR_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const GROUP_AVATAR_MAX_BYTES = 2 << 20;

/** Why a picked file cannot be the group's photo, said before it is sent; null when it may go. */
function groupAvatarFileProblem(file: File, t: TFunction): string | null {
  if (!GROUP_AVATAR_ACCEPT.split(",").includes(file.type)) return t("chat.group_avatar_wrong_type");
  if (file.size > GROUP_AVATAR_MAX_BYTES) return t("chat.group_avatar_too_large");
  return null;
}

/** The server's two refusals of the file in chat's words; anything else as chat says it. */
function toastGroupAvatarError(err: unknown, t: TFunction, fallback: string): void {
  const code = errorCode(err);
  if (code === "too_large") toast.error(t("chat.group_avatar_too_large"));
  else if (code === "unsupported_media_type") toast.error(t("chat.group_avatar_wrong_type"));
  else toastChatError(err, t, fallback);
}

/** The brand camera badge on a group's mark: 30px to the eye, a 44px target. */
function GroupAvatarCameraBadge() {
  return (
    <span className="flex size-7.5 items-center justify-center rounded-full border-2 border-surface-raised bg-primary text-primary-foreground shadow-menu">
      <Camera className="size-3.5" aria-hidden />
    </span>
  );
}

const GROUP_AVATAR_BADGE_BUTTON_CLASS =
  "absolute -right-3.5 -bottom-3.5 size-11 rounded-full p-0 hover:bg-transparent aria-expanded:bg-transparent";

/**
 * The group settings hero's mark. Members who may rename the group (the same
 * rule: canChangeProfile) get the camera badge: it picks a photo, or — once
 * the group has one — opens "Đổi ảnh nhóm" / "Gỡ ảnh nhóm".
 */
export function ChatGroupAvatarEditor({
  workspaceId,
  roomId,
  tint,
  imageUrl,
  canEdit,
}: {
  workspaceId: string;
  roomId: string;
  tint: Tint;
  imageUrl?: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const setAvatar = useSetChatRoomAvatar(workspaceId);
  const pending = setAvatar.isPending;
  const mark = <ChatSettingsRoomMark icon={Users} tint={tint} imageUrl={imageUrl} />;
  if (!canEdit) return mark;

  const send = (file: File | null) =>
    setAvatar.mutate({ roomId, file }, { onError: (err) => toastGroupAvatarError(err, t, t("chat.group_avatar_failed")) });
  const pick = () => {
    if (!pending) fileRef.current?.click();
  };
  const onPicked = (file: File | undefined) => {
    if (!file) return;
    const problem = groupAvatarFileProblem(file, t);
    if (problem) toast.error(problem);
    else send(file);
  };
  const label = t("chat.group_avatar_change");
  const badgeButton = (props: { onClick?: () => void; children?: ReactNode }) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={GROUP_AVATAR_BADGE_BUTTON_CLASS}
      aria-label={label}
      title={label}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      {...props}
    />
  );

  return (
    <div className="relative">
      {mark}
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/70">
          <Spinner label={t("chat.group_avatar_uploading")} className="size-5 text-foreground" />
        </span>
      ) : null}
      {imageUrl && !pending ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={badgeButton({})}>
            <GroupAvatarCameraBadge />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={pick}>
              <Camera className="size-4" aria-hidden />
              {label}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => send(null)}>
              <Trash2 className="size-4" aria-hidden />
              {t("chat.group_avatar_remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        badgeButton({ onClick: pick, children: <GroupAvatarCameraBadge /> })
      )}
      <input
        ref={fileRef}
        type="file"
        tabIndex={-1}
        aria-hidden
        accept={GROUP_AVATAR_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file again after a refusal fires onChange.
          event.target.value = "";
          onPicked(file);
        }}
      />
    </div>
  );
}
