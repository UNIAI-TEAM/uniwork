"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { useAuthStore, usePatchMe, useUploadAvatar } from "@uniwork/core/auth";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { initials } from "../../people/actor-chip";
import { SettingsCard, SettingsRow, SettingsSaveState, SettingsTab, SettingsValue } from "./settings-layout";
import { useAutoSave } from "./use-auto-save";

/** Mirrors `server/internal/handler/avatar.go`: the sniffed types and `maxAvatarBytes` (2 MiB). */
const AVATAR_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const AVATAR_MAX_BYTES = 2 << 20;

type AvatarError = "type" | "size" | "upload" | null;

function namesEqual(left: string, right: string) {
  return left === right;
}

export function AccountTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const user = useAuthStore((s) => s.user);
  const patchMe = usePatchMe();
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");

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

  // Saved state is reported inline beside the title; only a failure toasts.
  const autoSave = useAutoSave({
    value: displayName,
    savedValue: user?.display_name ?? "",
    onSave: saveProfile,
    onError: (err) => toastApiError(err, t("profile.toastFailed")),
    enabled: !!user && displayName.trim().length > 0,
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
          <Input
            value={displayName}
            autoComplete="name"
            aria-label={t("profile.displayName")}
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={autoSave.flush}
          />
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
  const [error, setError] = useState<AvatarError>(null);
  const pending = uploadAvatar.isPending;
  const name = user?.display_name ?? "";

  const pick = () => {
    if (!pending) fileRef.current?.click();
  };

  const onPicked = async (file: File | undefined) => {
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setError("type");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError("size");
      return;
    }
    setError(null);
    try {
      await uploadAvatar.mutateAsync(file);
      toast.success(t("toastAvatarUpdated"));
    } catch (err) {
      setError("upload");
      toastApiError(err, t("avatarUploadFailed"));
    }
  };

  const errorText =
    error === "type"
      ? t("avatarWrongType")
      : error === "size"
        ? t("avatarTooLarge")
        : error === "upload"
          ? t("avatarUploadFailed")
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
          <Button variant="outline" size="sm" aria-disabled={pending || undefined} onClick={pick}>
            {pending ? t("avatarUploading") : t("avatarChange")}
          </Button>
        </div>
        <span role="status" className="min-h-0 text-caption text-destructive empty:hidden">
          {errorText}
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
