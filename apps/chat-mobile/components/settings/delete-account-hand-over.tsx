// An owner whose organization has other members picks who takes it over, inside Settings › Delete account
// (delete-account.tsx): the sheet then hands the organization over with the password already typed and erases the
// account (Apple 5.1.1(v): deletion completes in the app). Who may take over is lib/owner-transfer.ts ›
// transferCandidates; the web stays a way out when the list cannot be read.
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { OwnedOrganization } from "@/lib/owned-organization";
import type { TransferCandidate } from "@/lib/owner-transfer";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";

export function HandOverPanel({
  organization,
  notice,
  candidates,
  loading,
  selected,
  onSelect,
  onRetry,
  error,
  busy,
  foreground,
  onOpenWeb,
}: {
  organization: OwnedOrganization;
  /** Why closing stopped being offered (someone joined meanwhile), said above the list. */
  notice: string | null;
  candidates: readonly TransferCandidate[];
  loading: boolean;
  selected: TransferCandidate | null;
  onSelect: (candidate: TransferCandidate) => void;
  onRetry: () => void;
  error: string | null;
  busy: boolean;
  foreground: string;
  onOpenWeb: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-2.5 rounded-xl border border-destructive/40 p-3.5" style={continuousCorners}>
      <Text accessibilityRole="header" className="text-body font-semibold text-foreground">
        {t("mobile.account.owner_title")}
      </Text>
      {notice ? <Text className="text-subhead leading-[21px] text-destructive">{notice}</Text> : null}
      <Text className="text-subhead leading-[21px] text-foreground">{t("mobile.account.transfer_body", { name: organization.name })}</Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel={t("common.loading")} color={foreground} />
      ) : candidates.length === 0 ? (
        <View className="gap-2">
          <Text className="text-subhead leading-[21px] text-muted-foreground">{t("mobile.account.transfer_empty")}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} className="min-h-11 justify-center self-start active:opacity-70">
            <Text className="text-subhead font-semibold text-primary">{t("mobile.account.transfer_retry")}</Text>
          </Pressable>
        </View>
      ) : (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("mobile.account.transfer_list")}
          className="overflow-hidden rounded-xl border border-border"
          style={continuousCorners}
        >
          {candidates.map((candidate, index) => {
            const checked = candidate.userId === selected?.userId;
            return (
              <Pressable
                key={candidate.userId}
                accessibilityRole="radio"
                accessibilityState={{ checked, disabled: busy }}
                accessibilityLabel={candidate.admin ? `${candidate.name}, ${t("mobile.account.transfer_admin")}` : candidate.name}
                accessibilityHint={candidate.email}
                testID={`hand-over-${candidate.userId}`}
                onPress={() => {
                  if (!busy) onSelect(candidate);
                }}
                className={cn("min-h-12 flex-row items-center gap-3 px-3.5 py-2 active:bg-secondary", index > 0 && "border-t-hairline border-border")}
              >
                <View
                  className={cn(
                    "h-5 w-5 items-center justify-center rounded-full border-2",
                    checked ? "border-primary" : "border-muted-foreground/50",
                  )}
                >
                  {checked ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                </View>
                <View className="flex-1">
                  <Text className="text-body text-foreground">{candidate.name}</Text>
                  {candidate.email && candidate.email !== candidate.name ? (
                    <Text className="text-footnote text-muted-foreground">{candidate.email}</Text>
                  ) : null}
                </View>
                {candidate.admin ? (
                  <Text className="text-caption font-semibold text-muted-foreground">{t("mobile.account.transfer_admin")}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
      {error ? (
        <Text accessibilityRole="alert" className="text-subhead text-destructive">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="link"
        // The label, not the children: the icon's glyph is a character a screen reader would spell.
        accessibilityLabel={t("mobile.account.owner_open_web")}
        onPress={onOpenWeb}
        className="min-h-11 flex-row items-center justify-center gap-2 rounded-full bg-muted px-4 py-2.5 active:opacity-70"
      >
        <Text className="text-subhead font-semibold text-foreground">{t("mobile.account.owner_open_web")}</Text>
        <Ionicons name="open-outline" size={16} color={foreground} />
      </Pressable>
    </View>
  );
}
