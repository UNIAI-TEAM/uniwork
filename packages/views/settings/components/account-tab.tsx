"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuthStore, usePatchMe, useUploadAvatar } from "@uniwork/core/auth";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Input } from "@uniwork/ui/components/ui/input";
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveState,
  SettingsSection,
  SettingsTab,
} from "./settings-layout";
import { useAutoSave } from "./use-auto-save";

function namesEqual(left: string, right: string) {
  return left === right;
}

export function AccountTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings" });
  const user = useAuthStore((s) => s.user);
  const patchMe = usePatchMe();
  const uploadAvatar = useUploadAvatar();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");

  useEffect(() => {
    setDisplayName(user?.display_name ?? "");
  }, [user?.id, user?.display_name]);

  const savedName = user?.display_name ?? "";
  const draft = useMemo(() => displayName, [displayName]);

  const saveProfile = useCallback(
    async (name: string) => {
      const updated = await patchMe.mutateAsync({ display_name: name });
      if (!updated) throw new Error(t("profile.toastFailed"));
    },
    [patchMe, t],
  );

  const autoSave = useAutoSave({
    value: draft,
    savedValue: savedName,
    onSave: saveProfile,
    onSuccess: () => toast.success(t("profile.toastUpdated"), { id: "settings-auto-save" }),
    onError: () => toast.error(t("profile.toastFailed")),
    enabled: !!user && displayName.trim().length > 0,
    isEqual: namesEqual,
  });

  const onAvatarPick = async (file: File | undefined) => {
    if (!file) return;
    try {
      await uploadAvatar.mutateAsync(file);
      toast.success(t("profile.toastAvatarUpdated"), { id: "settings-auto-save" });
    } catch {
      toast.error(t("profile.toastFailed"));
    }
  };

  return (
    <SettingsTab title={t("page.tabs.profile")}>
      <SettingsSection
        title={t("profile.section")}
        action={
          <SettingsSaveState
            status={autoSave.status}
            savingLabel={t("save.saving")}
            savedLabel={t("save.saved")}
            errorLabel={t("save.error")}
          />
        }
      >
        <SettingsCard>
          <SettingsRow label={t("profile.avatar")} description={t("profile.avatarHint")} size="none">
            <div className="flex justify-start sm:justify-end">
              <button
                type="button"
                className="group relative rounded-full"
                aria-label={t("profile.avatar")}
                disabled={uploadAvatar.isPending}
                onClick={() => fileRef.current?.click()}
              >
                <ActorAvatar
                  name={user?.display_name ?? ""}
                  initials={(user?.display_name ?? "?").slice(0, 1).toUpperCase()}
                  avatarUrl={user?.avatar_url}
                  size="2xl"
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="size-5 text-foreground" aria-hidden />
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="sr-only"
                onChange={(e) => void onAvatarPick(e.target.files?.[0])}
              />
            </div>
          </SettingsRow>
          <SettingsRow label={t("profile.displayName")} size="text">
            <Input
              value={displayName}
              autoComplete="name"
              aria-label={t("profile.displayName")}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={autoSave.flush}
            />
          </SettingsRow>
          <SettingsRow label={t("profile.email")} size="text">
            <Input value={user?.email ?? ""} readOnly aria-readonly className="text-muted-foreground" />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}
