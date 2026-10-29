// The workspace picker once the server said the account has no workspace (spec §5.2): the invitations waiting for
// its address, each joined in place; or, with none, what to do instead. Someone already in an organization waits for
// an admin; someone in none is told no invitation reached this address and may start an organization on the web
// (the app creates none); an Apple relay account hears why an invitation to its work email misses it (ADR 0041):
// Hide My Email gives each app its own forwarding address, so the account has that address, not the person's own,
// and an invitation sent to their work email names another account (server/internal/service/invitation_accept.go ›
// sameMailbox).
// A list that could not be read says so with Retry, never "nobody invited you".
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { isAppleRelayEmail } from "@uniwork/core/auth/sign-in-rules";
import { paths } from "@uniwork/core/paths/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { holdsOrganization } from "@uniwork/core/types/organization";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { NoticeCard } from "@/components/auth/auth-layout";
import { useReaderFocus } from "@/components/auth/use-reader-focus";
import { useOpenWebPage } from "@/components/settings/use-open-web-page";
import { Button } from "@/components/ui/button";
import { ListLoadError } from "@/components/ui/list-states";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { myInvitationsOptions, myOrganizationsOptions } from "@/data/queries/invitations";
import { THEME } from "@/lib/theme";
import { InvitationCard, InvitationSkeleton } from "./invitation-parts";
import { useJoinInvitation } from "./use-join-invitation";

export function PendingInvitations({ email }: { email: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const openWebPage = useOpenWebPage();
  const invitations = useQuery(myInvitationsOptions());
  // Asked beside the list, so an empty one already knows what to say instead.
  const organizations = useQuery(myOrganizationsOptions());
  const { busy, joined, join, refusalOf } = useJoinInvitation();
  const appUrl = runtimeConfig().appUrl;
  const now = Date.now();
  // /invitations, not /invite/{token}: the invite link is the app's universal link and would come straight back here.
  const switchOnWeb = () => openWebPage(`${appUrl}${paths.invitations()}`);

  // The card whose "Tham gia" was pressed is gone: the reader moves to the notice, which says it.
  const joinedRef = useReaderFocus(joined !== null);
  const joinedNotice = joined ? (
    <NoticeCard
      ref={joinedRef}
      announce={false}
      message={t("mobile.invitations.joined_no_workspace", { org: joined })}
      testID="invitations-joined"
    />
  ) : null;

  if (invitations.isPending) return <InvitationSkeleton />;
  if (invitations.isError || invitations.data === null) {
    return <ListLoadError title={t("invitations.load_error")} onRetry={() => void invitations.refetch()} testID="invitations-error" />;
  }
  const list = invitations.data;
  if (list.length > 0) {
    return (
      <View className="gap-3">
        {joinedNotice}
        <Text accessibilityRole="header" className="px-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground">
          {t("invitations.list_title")}
        </Text>
        {list.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            invitation={invitation}
            now={now}
            busy={busy === invitation.token}
            disabled={busy !== null && busy !== invitation.token}
            refusal={refusalOf(invitation.token)}
            onJoin={() => void join(invitation.token)}
            onContinueOnWeb={switchOnWeb}
          />
        ))}
      </View>
    );
  }

  if (organizations.isPending && !joined) return <InvitationSkeleton />;
  const inOrganization = joined !== null || (organizations.data ?? []).some(holdsOrganization);
  if (inOrganization) {
    return (
      joinedNotice ?? (
        <Text selectable className="text-callout leading-[22px] text-muted-foreground" testID="invitations-wait-for-admin">
          {t("mobile.account.no_workspace")}
        </Text>
      )
    );
  }
  return (
    <View className="gap-4" testID="invitations-none">
      <View className="gap-1.5">
        <Text selectable className="text-body font-semibold text-foreground">
          {t("mobile.invitations.none", { email })}
        </Text>
        <Text className="text-callout leading-[22px] text-muted-foreground">
          {isAppleRelayEmail(email) ? t("mobile.account.no_workspace_relay", { email }) : t("mobile.invitations.none_hint")}
        </Text>
      </View>
      <Button
        variant="outline"
        // The Button primitive says "button"; this one leaves the app for the web.
        role="link"
        // The label, not the children: the icon's glyph is a character a screen reader would spell.
        accessibilityLabel={t("mobile.invitations.create_org")}
        onPress={() => openWebPage(`${appUrl}${paths.getStarted()}`)}
        className="min-h-12 rounded-full py-3"
        testID="invitations-create-org"
      >
        <Text className="text-subhead font-semibold">{t("mobile.invitations.create_org")}</Text>
        <Ionicons name="open-outline" size={16} color={THEME[colorScheme].foreground} />
      </Button>
    </View>
  );
}
