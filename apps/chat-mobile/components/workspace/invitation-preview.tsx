// The invitation an invite link opened (spec §5.2), kept through sign-in (lib/deep-link.ts): what it is to (the
// organization, the workspaces it opens or none yet, the role, who invited, how long it has left) and "Tham gia",
// never joined by the link alone. An account that still belongs to another organization makes the switch on the web.
// An invitation that no longer works says why; a refusal (another account's link, an address not proved yet, an
// organization not taking members) says what to do next, in the web's words.
import { useQuery } from "@tanstack/react-query";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import type { InvitationPreview as Preview } from "@uniwork/core/types/workspace";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { AuthHeading, NoticeCard, SubmitButton, TextButton } from "@/components/auth/auth-layout";
import { useReaderFocus } from "@/components/auth/use-reader-focus";
import { useOpenWebPage } from "@/components/settings/use-open-web-page";
import { Text } from "@/components/ui/text";
import { useAuthStore } from "@/data/auth/store";
import { invitationPreviewOptions } from "@/data/queries/invitations";
import {
  daysLeft,
  invitationWorkspaceNames,
  inviteErrorHintKey,
  inviteErrorKey,
  inviteErrorRetries,
  inviteRefusal,
  previewState,
  type GoneReason,
  type InviteErrorReason,
  type InviteRefusal,
} from "@/lib/invitations";
import { continuousCorners } from "@/lib/radius";
import { signInRoutes } from "@/lib/sign-in-routes";
import { RefusalNote, SwitchOnWeb, useRoleLabel } from "./invitation-parts";
import { useJoinInvitation } from "./use-join-invitation";

const home = () => router.replace("/");

export function InvitationPreview({ token }: { token: string }) {
  const preview = useQuery(invitationPreviewOptions(token));
  const join = useJoinInvitation();
  // Joined: whatever the invitation reads as now (used), what the person did is what the screen says.
  if (join.joined) return <Joined organization={join.joined} />;
  if (preview.isPending) return <PreviewSkeleton />;
  if (preview.isError) {
    const refusal = inviteRefusal(preview.error);
    if (refusal.kind === "gone") return <Gone reason={refusal.reason} />;
    return <Refused reason={refusal.kind === "error" ? refusal.reason : "failed"} onRetry={() => void preview.refetch()} />;
  }
  if (!preview.data) return <Refused reason="failed" onRetry={() => void preview.refetch()} />;
  const state = previewState(preview.data);
  if (state.kind === "gone") return <Gone reason={state.reason} />;
  const refusal = join.refusalOf(token);
  if (refusal?.kind === "gone") return <Gone reason={refusal.reason} focus />;
  return (
    <Pending
      preview={preview.data}
      switchFirst={state.switchFirst || refusal?.kind === "switch"}
      busy={join.busy === token}
      refusal={refusal}
      onJoin={() => void join.join(token)}
    />
  );
}

function Pending({
  preview,
  switchFirst,
  busy,
  refusal,
  onJoin,
}: {
  preview: Preview;
  switchFirst: boolean;
  busy: boolean;
  refusal: InviteRefusal | null;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  const openWebPage = useOpenWebPage();
  const roleLabel = useRoleLabel();
  const { invitation } = preview;
  const organization = invitation.organization.name;
  const inviter = invitation.inviter_name?.trim() ?? "";
  const workspaces = invitationWorkspaceNames(invitation).join(", ");
  const days = daysLeft(invitation.expires_at, Date.now());
  const rows = [
    { label: t("invitations.preview.organization"), value: organization },
    { label: t("invitations.preview.workspace"), value: workspaces || t("invitations.preview.no_workspace") },
    { label: t("invitations.preview.role"), value: roleLabel(invitation.org_role) },
    { label: t("invitations.preview.inviter"), value: inviter },
    { label: t("invitations.preview.expiry"), value: days === null ? "" : t("invitations.preview.expires_in", { count: days }) },
  ].filter((row) => row.value !== "");
  // /invitations, not /invite/{token}: the invite link is the app's universal link and would come straight back.
  const continueOnWeb = () => openWebPage(`${runtimeConfig().appUrl}${paths.invitations()}`);
  return (
    <View className="gap-6" testID="invitation-preview">
      <AuthHeading
        title={t("invitations.preview.title", { name: organization })}
        subtitle={inviter ? t("invitations.preview.description_inviter", { inviter }) : t("invitations.preview.description")}
      />
      <View className="overflow-hidden rounded-2xl border border-border bg-card" style={continuousCorners}>
        {rows.map(({ label, value }, index) => (
          <View
            key={label}
            accessible
            accessibilityLabel={`${label}: ${value}`}
            className={index > 0 ? "gap-0.5 border-t-hairline border-border px-4 py-3" : "gap-0.5 px-4 py-3"}
          >
            <Text className="text-footnote text-muted-foreground">{label}</Text>
            <Text className="text-body text-foreground">{value}</Text>
          </View>
        ))}
      </View>
      {switchFirst ? (
        // Said where the reader is when it replaced "Tham gia"; on open it is simply part of the screen.
        <SwitchOnWeb organization={organization} focus={refusal?.kind === "switch"} onContinueOnWeb={continueOnWeb} />
      ) : (
        <View className="gap-3">
          {refusal ? <RefusalNote refusal={refusal} organization={organization} onContinueOnWeb={continueOnWeb} /> : null}
          <SubmitButton
            label={t("invitations.preview.join")}
            busyLabel={t("mobile.invitations.joining")}
            busy={busy}
            onPress={onJoin}
            testID="invitation-preview-join"
          />
          <View className="items-center">
            <TextButton label={t("common.later")} tone="muted" disabled={busy} onPress={home} testID="invitation-preview-later" />
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Joined the organization with no workspace to open yet: the reader moves to the notice, which says it (an
 * announcement beside the focus move would be cut off), then "Tiếp tục" goes home.
 */
function Joined({ organization }: { organization: string }) {
  const { t } = useTranslation();
  const noticeRef = useReaderFocus(true);
  return (
    <View className="gap-6" testID="invitation-joined">
      <AuthHeading title={t("invitations.preview.title", { name: organization })} />
      <NoticeCard
        ref={noticeRef}
        announce={false}
        message={t("mobile.invitations.joined_no_workspace", { org: organization })}
        testID="invitation-joined-notice"
      />
      <SubmitButton label={t("common.continue")} onPress={home} testID="invitation-joined-continue" />
    </View>
  );
}

/** An invitation that no longer works; `focus` when a join just found it so (the reader's button went with it). */
function Gone({ reason, focus = false }: { reason: GoneReason; focus?: boolean }) {
  const { t } = useTranslation();
  const titleRef = useReaderFocus(focus);
  const title = t("invitations.gone.title");
  const why = t(`invitations.gone.${reason}`);
  return (
    <View className="gap-6" testID="invitation-gone">
      {/* One stop, still a heading: the title and why, where the reader lands. */}
      <View ref={titleRef} accessible accessibilityRole="header" accessibilityLabel={`${title}. ${why}`} testID="preview-gone-title">
        <AuthHeading title={title} subtitle={why} />
      </View>
      <Text className="text-callout leading-[22px] text-muted-foreground">{t(`invitations.gone.hint_${reason}`)}</Text>
      <SubmitButton label={t("workspace.acceptInviteError.goToWorkspaces")} variant="outline" onPress={home} testID="invitation-home" />
    </View>
  );
}

/** A refusal of the preview: what it means, the one action that answers it, and the way home. */
function Refused({ reason, onRetry }: { reason: InviteErrorReason; onRetry: () => void }) {
  const { t } = useTranslation();
  const logout = useAuthStore((s) => s.logout);
  const hint = inviteErrorHintKey(reason);
  const action =
    reason === "wrongAccount" ? (
      <SubmitButton label={t("workspace.acceptInviteError.switchAccount")} onPress={() => void logout()} testID="invitation-switch-account" />
    ) : reason === "unverified" ? (
      <SubmitButton label={t("workspace.acceptInviteError.verifyEmail")} onPress={() => router.replace(signInRoutes.verifyEmail)} />
    ) : inviteErrorRetries(reason) ? (
      <SubmitButton label={t("common.retry")} onPress={onRetry} testID="invitation-retry" />
    ) : null;
  return (
    <View className="gap-6" testID={`invitation-refused-${reason}`}>
      <AuthHeading title={t("workspace.acceptInviteError.title")} subtitle={t(inviteErrorKey(reason))} />
      {hint ? <Text className="text-callout leading-[22px] text-muted-foreground">{t(hint)}</Text> : null}
      <View className="gap-3">
        {action}
        <SubmitButton label={t("workspace.acceptInviteError.goToWorkspaces")} variant="outline" onPress={home} testID="invitation-home" />
      </View>
    </View>
  );
}

/** The heading and the details card's outline, in their final shape, while the invitation is read. */
function PreviewSkeleton() {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} className="gap-6" testID="invitation-loading">
      <View className="gap-3">
        <View className="h-8 w-56 rounded-full bg-muted" />
        <View className="h-4 w-64 rounded-full bg-muted" />
      </View>
      <View className="gap-4 rounded-2xl border border-border bg-card p-4" style={continuousCorners}>
        {[120, 160, 96, 140].map((width) => (
          <View key={width} className="gap-1.5">
            <View className="h-3 w-20 rounded-full bg-muted" />
            <View className="h-4 rounded-full bg-muted" style={{ width }} />
          </View>
        ))}
      </View>
      <View className="min-h-12 rounded-full bg-muted" />
    </View>
  );
}
