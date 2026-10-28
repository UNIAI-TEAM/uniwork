// The pieces of an invitation on the phone (spec §5.2), shared by the empty workspace picker and the preview a link
// opens: one card per invitation (who invited, the organization and the workspaces it opens, the role, how long it has
// left, and "Tham gia"), its outline while the list loads, and what a refused join says under it: the web's switch
// when the account still belongs to another organization, an invitation that no longer works, or the server's
// refusal in the web's words (lib/invitations.ts). A refusal that takes "Tham gia" away moves the reader to what
// replaced it (the button they were on is gone); one that leaves it is said where it shows.
import { Ionicons } from "@expo/vector-icons";
import type { PendingInvitation } from "@uniwork/core/types/workspace";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { FieldNote } from "@/components/auth/auth-field";
import { SubmitButton } from "@/components/auth/auth-layout";
import { useReaderFocus } from "@/components/auth/use-reader-focus";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import {
  daysLeft,
  expiresSoon,
  invitationWorkspaceNames,
  inviteErrorHintKey,
  inviteErrorKey,
  roleKey,
  type InviteRefusal,
} from "@/lib/invitations";
import { continuousCorners } from "@/lib/radius";
import { THEME } from "@/lib/theme";
import { WorkspaceAvatar } from "./workspace-avatar";

const CARD = "gap-3.5 rounded-2xl border border-border bg-card p-4";

/** The role's name, or the role as it came when this app does not know it. */
export function useRoleLabel(): (role: string) => string {
  const { t } = useTranslation();
  return (role) => {
    const key = roleKey(role);
    return key ? t(key) : role;
  };
}

interface CardProps {
  invitation: PendingInvitation;
  now: number;
  /** this invitation is being joined */
  busy: boolean;
  /** another one is: dimmed, ignoring taps */
  disabled: boolean;
  refusal: InviteRefusal | null;
  onJoin: () => void;
  onContinueOnWeb: () => void;
}

export function InvitationCard({ invitation, now, busy, disabled, refusal, onJoin, onContinueOnWeb }: CardProps) {
  const { t } = useTranslation();
  const roleLabel = useRoleLabel();
  const organization = invitation.organization.name;
  const workspaces = invitationWorkspaceNames(invitation).join(", ");
  // An inviter whose name came back empty would leave " mời bạn vào".
  const inviter = invitation.invited_by.display_name.trim();
  const days = daysLeft(invitation.expires_at, now);
  const soon = expiresSoon(invitation.expires_at, now);
  const lead = inviter ? t("invitations.invitedBy", { name: inviter }) : t("invitations.invited");
  const meta = [roleLabel(invitation.org_role), days === null ? null : t("invitations.preview.expires_in", { count: days })]
    .filter(Boolean)
    .join(" · ");
  // A switch or a gone invitation has nothing left to join here: its way out replaces the button.
  const joinable = refusal === null || refusal.kind === "error";
  return (
    <View className={CARD} style={continuousCorners} testID={`invitation-${invitation.id}`}>
      <View
        accessible
        accessibilityLabel={[
          lead,
          workspaces ? t("invitations.place", { workspace: workspaces, organization }) : organization,
          meta,
          soon ? t("invitations.expires_soon") : null,
        ]
          .filter(Boolean)
          .join(", ")}
        className="flex-row gap-3.5"
      >
        <WorkspaceAvatar name={organization} size={44} seed={invitation.organization.id} />
        <View className="flex-1 gap-0.5">
          <Text className="text-footnote text-muted-foreground">{lead}</Text>
          <Text className="text-body font-display font-bold text-foreground">
            {workspaces ? `${organization} › ${workspaces}` : organization}
          </Text>
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1 pt-0.5">
            <Text className="text-footnote text-muted-foreground">{meta}</Text>
            {soon ? (
              <View className="rounded-full bg-tint-yellow px-2 py-0.5">
                <Text className="text-caption font-semibold text-tint-yellow-foreground">{t("invitations.expires_soon")}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
      {refusal ? <RefusalNote refusal={refusal} organization={organization} onContinueOnWeb={onContinueOnWeb} /> : null}
      {joinable ? (
        <SubmitButton
          label={t("invitations.join")}
          busyLabel={t("mobile.invitations.joining")}
          busy={busy}
          disabled={disabled}
          onPress={onJoin}
          testID={`invitation-join-${invitation.id}`}
        />
      ) : null}
    </View>
  );
}

/** What a refused join says, and its way out when it has one. */
export function RefusalNote({
  refusal,
  organization,
  onContinueOnWeb,
}: {
  refusal: InviteRefusal;
  organization: string;
  onContinueOnWeb: () => void;
}) {
  const { t } = useTranslation();
  // "Tham gia" is gone with these two: the reader moves to the note that took its place.
  const goneRef = useReaderFocus(refusal.kind === "gone");
  if (refusal.kind === "switch") {
    return <SwitchOnWeb organization={organization} focus onContinueOnWeb={onContinueOnWeb} />;
  }
  if (refusal.kind === "gone") {
    const title = t(`invitations.gone.${refusal.reason}`);
    const hint = t(`invitations.gone.hint_${refusal.reason}`);
    return (
      <View
        ref={goneRef}
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${title} ${hint}`}
        className="gap-1"
        testID="refusal-gone-note"
      >
        <Text className="text-callout font-semibold text-foreground">{title}</Text>
        <Text className="text-footnote leading-[18px] text-muted-foreground">{hint}</Text>
      </View>
    );
  }
  const hint = inviteErrorHintKey(refusal.reason);
  return (
    <View className="gap-1">
      <FieldNote error={t(inviteErrorKey(refusal.reason))} />
      {hint ? <Text className="text-footnote leading-[18px] text-muted-foreground">{t(hint)}</Text> : null}
    </View>
  );
}

/**
 * The account still belongs to another organization: what joining means, and the web, where the switch is made.
 * `focus`: it replaced the "Tham gia" just pressed, so the reader moves to its words.
 */
export function SwitchOnWeb({
  organization,
  focus = false,
  onContinueOnWeb,
}: {
  organization: string;
  focus?: boolean;
  onContinueOnWeb: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const wordsRef = useReaderFocus(focus);
  const description = t("invitations.switch.description", { name: organization });
  const hint = t("mobile.invitations.switch_hint");
  return (
    <View className="gap-3">
      <View ref={wordsRef} accessible accessibilityLabel={`${description} ${hint}`} className="gap-1" testID="refusal-switch-note">
        <Text className="text-callout leading-5 text-foreground">{description}</Text>
        <Text className="text-footnote leading-[18px] text-muted-foreground">{hint}</Text>
      </View>
      <Button
        variant="outline"
        // The Button primitive says "button"; this one leaves the app for the web.
        role="link"
        // The label, not the children: the icon's glyph is a character a screen reader would spell.
        accessibilityLabel={t("mobile.invitations.continue_on_web")}
        onPress={onContinueOnWeb}
        className="min-h-12 rounded-full py-3"
        testID="invitation-continue-on-web"
      >
        <Text className="text-body font-semibold">{t("mobile.invitations.continue_on_web")}</Text>
        <Ionicons name="open-outline" size={16} color={THEME[colorScheme].foreground} />
      </Button>
    </View>
  );
}

/** Two cards' outlines while the invitations load, in the cards' own shape so nothing moves when they arrive. */
export function InvitationSkeleton() {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} className="gap-3" testID="invitations-loading">
      {[180, 140].map((width) => (
        <View key={width} className={CARD} style={continuousCorners}>
          <View className="flex-row gap-3.5">
            <View className="h-11 w-11 rounded-[13px] bg-muted" />
            <View className="flex-1 gap-2 pt-0.5">
              <View className="h-3 w-24 rounded-full bg-muted" />
              <View className="h-4 rounded-full bg-muted" style={{ width }} />
              <View className="h-3 w-32 rounded-full bg-muted" />
            </View>
          </View>
          <View className="min-h-12 rounded-full bg-muted" />
        </View>
      ))}
    </View>
  );
}
