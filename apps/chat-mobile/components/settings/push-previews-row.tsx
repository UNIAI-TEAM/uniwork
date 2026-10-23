// Settings › Privacy & security: whether this person's chat pushes show the
// message's words. The
// choice is the server's (PUT /me/push-previews, data/push-previews.ts); when
// the organization hides the words for everyone (GET /orgs/{org}/
// push-preview-policy) the switch reads off, cannot be moved, and says why.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "@/components/ui/a11y";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { useSetPushPreviews } from "@/data/mutations/account";
import { pushPreviewPolicyOptions } from "@/data/queries/push-previews";
import { SwitchRow } from "./switch-row";

export function PushPreviewsRow({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const policy = useQuery({ ...pushPreviewPolicyOptions(orgSlug), enabled: orgSlug !== "" });
  const setPreviews = useSetPushPreviews();
  const [failed, setFailed] = useState(false);
  const orgHidden = policy.data?.hidden === true;

  const onChange = async (show: boolean) => {
    setFailed(false);
    try {
      await setPreviews.mutateAsync(show);
    } catch {
      setFailed(true);
    }
  };

  // The notice's live region is TalkBack's; VoiceOver hears it through an announcement.
  useAnnounce(failed ? t("mobile.security.previews_failed") : null);

  return (
    <>
      <SwitchRow
        first
        icon="chatbubble-ellipses-outline"
        tint="blue"
        label={t("mobile.security.previews")}
        hint={orgHidden ? t("mobile.security.previews_org_hidden") : t("mobile.security.previews_hint")}
        value={!orgHidden && user?.push_previews !== false}
        disabled={orgHidden || user === null || setPreviews.isPending}
        onChange={(show) => void onChange(show)}
      />
      {failed ? (
        <Text accessibilityLiveRegion="polite" className="px-4 pb-3 text-callout text-destructive">
          {t("mobile.security.previews_failed")}
        </Text>
      ) : null}
    </>
  );
}
