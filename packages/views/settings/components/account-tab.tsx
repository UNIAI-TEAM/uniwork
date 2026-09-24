"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@uniwork/core/api";
import { useAuthStore, usePatchMe, useUploadAvatar } from "@uniwork/core/auth";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { initials } from "../../people/actor-chip";
import { cn } from "@uniwork/ui/lib/utils";
import {
  SettingsCard,
  SettingsFieldError,
  SettingsRow,
  SettingsSaveState,
  SettingsTab,
  SettingsValue,
} from "./settings-layout";
import { useAutoSave } from "./use-auto-save";

/** Mirrors `server/internal/handler/avatar.go`: the sniffed types and `maxAvatarBytes` (2 MiB). */
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const AVATAR_MAX_BYTES = 2 << 20;
/** Mirrors `maxDisplayNameRunes` in `server/internal/service/auth.go`. */
const DISPLAY_NAME_MAX = 100;

/** What the avatar row last said: a refusal (with the server's words) or the upload landing. */
type AvatarNotice = { kind: "type" | "size" } | { kind: "upload"; message?: string } | { kind: "done" } | null;

function namesEqual(left: string, right: string) {
  return left === right;
}

export function AccountTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const user = useAuthStore((s) => s.user);
  const patchMe = usePatchMe();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const nameErrorId = useId();
  const nameEmpty = displayName.trim().length === 0;

  useEffect(() => {
    setDisplayName(user?.display_name ?? "");
  }, [user?.id, user?.display_name]);

  const saveProfile = useCallback(
    async (name: string) => {
      const updated = await patchMe.mutateAsync({ display_name: name });
      if (!updated) throw new Error(t("profile.toastFailed"));
    },
    [patchMe, t],
  );

  // Success and failure both report inline beside the title, never a toast.
  // An empty name is not sent: the field says why instead.
  const autoSave = useAutoSave({
    value: displayName,
    savedValue: user?.display_name ?? "",
    onSave: saveProfile,
    enabled: !!user && !nameEmpty,
    isEqual: namesEqual,
  });

  return (
    <SettingsTab
      title={t("page.tabs.profile")}
      actions={
        <SettingsSaveState
          status={autoSave.status}
          savingLabel={t("save.saving")}
          savedLabel={t("save.saved")}
          errorLabel={t("save.error")}
        />
      }
    >
      <SettingsCard>
        <AvatarRow />
        <SettingsRow label={t("profile.displayName")} size="text">
          <div className="flex flex-col gap-1.5">
            <Input
              value={displayName}
              autoComplete="name"
              maxLength={DISPLAY_NAME_MAX}
              aria-label={t("profile.displayName")}
              aria-invalid={nameEmpty || undefined}
              aria-describedby={nameEmpty ? nameErrorId : undefined}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => {
                // Leaving the field empty would leave a name that is shown but
                // never saved; put the saved one back instead.
                if (nameEmpty) setDisplayName(user?.display_name ?? "");
                else autoSave.flush();
              }}
            />
            {nameEmpty ? <SettingsFieldError id={nameErrorId}>{t("profile.displayNameRequired")}</SettingsFieldError> : null}
          </div>
        </SettingsRow>
        <SettingsRow label={t("profile.email")} description={t("profile.emailHint")} size="text">
          <SettingsValue>{user?.email ?? ""}</SettingsValue>
        </SettingsRow>
      </SettingsCard>
    </SettingsTab>
  );
}

/**
 * The avatar says it can be changed without a hover: a camera badge sits on
 * it at all times and a text button names the action, so touch and keyboard
 * users see the same affordance as a mouse.
 */
function AvatarRow() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.profile" });
  const user = useAuthStore((s) => s.user);
  const uploadAvatar = useUploadAvatar();
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<AvatarNotice>(null);
  const pending = uploadAvatar.isPending;
  const name = user?.display_name ?? "";

  const pick = () => {
    if (!pending) fileRef.current?.click();
  };

  const onPicked = async (file: File | undefined) => {
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setNotice({ kind: "type" });
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setNotice({ kind: "size" });
      return;
    }
    setNotice(null);
    // One channel: the line under the button, where the reader acted. The
    // new photo itself is the success signal; the line only confirms it.
    try {
      await uploadAvatar.mutateAsync(file);
      setNotice({ kind: "done" });
    } catch (err) {
      setNotice({ kind: "upload", message: apiErrorMessage(err) });
    }
  };

  const noticeText =
    notice?.kind === "type"
      ? t("avatarWrongType")
      : notice?.kind === "size"
        ? t("avatarTooLarge")
        : notice?.kind === "upload"
          ? (notice.message ?? t("avatarUploadFailed"))
          : notice?.kind === "done"
            ? t("toastAvatarUpdated")
            : null;

  return (
    <SettingsRow label={t("avatar")} description={t("avatarHint")} size="none">
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <div className="flex items-center gap-3">
          {/* A pointer shortcut to the same action as the text button beside
              it, which is the one keyboard and screen-reader path; hidden from
              both so the action is not announced twice. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="relative shrink-0 cursor-pointer rounded-full"
            onClick={pick}
          >
            <ActorAvatar name={name} initials={initials(name)} avatarUrl={user?.avatar_url} size="2xl" />
            {pending ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Loader2 aria-hidden className="size-5 animate-spin text-foreground" />
              </span>
            ) : null}
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-muted-foreground"
            >
              <Camera className="size-3" />
            </span>
          </button>
          <Button
            variant="outline"
            size="sm"
            aria-disabled={pending || undefined}
            aria-busy={pending || undefined}
            onClick={pick}
          >
            {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
            {pending ? t("avatarUploading") : t("avatarChange")}
          </Button>
        </div>
        {/* Mounted while empty so the first message is announced. */}
        <span
          role="status"
          className={cn(
            "flex min-h-0 items-center gap-1.5 text-caption empty:hidden",
            notice?.kind === "done" ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {notice?.kind === "done" ? <Check aria-hidden className="size-3.5 shrink-0 text-success" /> : null}
          {noticeText}
        </span>
        <input
          ref={fileRef}
          type="file"
          tabIndex={-1}
          aria-hidden
          accept={AVATAR_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Clear so picking the same file again after an error fires onChange.
            e.target.value = "";
            void onPicked(file);
          }}
        />
      </div>
    </SettingsRow>
  );
}
