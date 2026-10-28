// One row of Settings › Sign-in methods (sign-in-methods-section.tsx): the method's mark in a 32 pt tile, its name
// and state, what it shows (the address or "Email ẩn của Apple", the date), and its one action. An unlink the rules
// refuse keeps its button in the reader's path, dimmed and marked unavailable, with the reason under the row. At the
// accessibility text sizes the action moves under the text. Also the rows' outline while they load, and the row that
// says they could not be read.
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import googleMark from "@/assets/google-g.png";
import { useLargeText } from "@/components/ui/a11y";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { dateTimeFormat } from "@/lib/locale-format";
import type { MethodRow } from "@/lib/sign-in-methods";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

function useDate(): (iso: string | null) => string | null {
  const { i18n } = useTranslation();
  return (iso) => {
    const at = iso ? Date.parse(iso) : Number.NaN;
    return Number.isNaN(at) ? null : dateTimeFormat(i18n.language, DATE).format(at);
  };
}

/** What the row says, its badge, and its action's words. */
function useRowWords(row: MethodRow) {
  const { t } = useTranslation();
  const date = useDate();
  const M = "settings.security.signInMethods";
  if (row.kind === "password") {
    const changed = date(row.changedAt);
    return {
      name: t(`${M}.password.name`),
      meta: row.set ? (changed ? t(`${M}.password.changedOn`, { date: changed }) : t(`${M}.password.set`)) : t(`${M}.password.unset`),
      badge: t(row.set ? `${M}.badge.set` : `${M}.badge.unset`),
      action: t(row.set ? `${M}.password.changeAction` : `${M}.password.setAction`),
      actionLabel: t(row.set ? `${M}.password.changeAction` : `${M}.password.setAction`),
      busyLabel: t("common.loading"),
      hint: null,
    };
  }
  const provider = t(`auth.social.provider.${row.kind}`);
  const linkedOn = date(row.linkedAt);
  const address = row.email.kind === "relay" ? t("auth.apple.relayEmail") : row.email.kind === "address" ? row.email.email : null;
  const when = row.linked ? (linkedOn ? t(`${M}.provider.linkedOn`, { date: linkedOn }) : t(`${M}.provider.linked`)) : null;
  return {
    name: provider,
    meta: row.linked ? [address, when].filter(Boolean).join(" · ") : t(`${M}.provider.notLinked`, { provider }),
    badge: row.linked ? t(`${M}.badge.linked`) : null,
    action: row.linked ? t(`${M}.provider.unlink`) : row.link === "web" ? t(`${M}.provider.linkOnWeb`) : t(`${M}.provider.link`),
    actionLabel: row.linked
      ? t("mobile.sign_in_methods.unlink_named", { provider })
      : row.link === "web"
        ? t(`${M}.provider.linkOnWeb`)
        : t("mobile.sign_in_methods.link_named", { provider }),
    busyLabel: row.linked ? t(`${M}.unlink.pending`) : t(`${M}.provider.linking`, { provider }),
    hint: !row.linked && row.link === "web" ? t(`${M}.provider.linkOnWebHint`, { provider }) : null,
  };
}

function Mark({ kind }: { kind: MethodRow["kind"] }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View
      className="h-8 w-8 items-center justify-center rounded-[9px] bg-muted"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {kind === "google" ? (
        <Image source={googleMark} style={{ width: 18, height: 18 }} contentFit="contain" accessible={false} />
      ) : (
        <Ionicons
          name={kind === "apple" ? "logo-apple" : "key-outline"}
          size={18}
          color={kind === "apple" ? theme.foreground : theme.mutedForeground}
        />
      )}
    </View>
  );
}

interface RowProps {
  row: MethodRow;
  first: boolean;
  /** this row's action runs */
  busy: boolean;
  /** another one does: dimmed, ignoring taps */
  disabled: boolean;
  onAction: () => void;
}

export function MethodRowView({ row, first, busy, disabled, onAction }: RowProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const large = useLargeText();
  const tap = useTapTarget(44);
  const words = useRowWords(row);
  const refused = row.kind !== "password" && row.linked && !row.unlink.allowed ? row.unlink : null;
  const reason = refused?.allowed === false && refused.key ? t(refused.key) : null;
  const unavailable = reason !== null;
  const web = row.kind !== "password" && !row.linked && row.link === "web";
  return (
    <View className={cn("gap-2 py-3 ps-4 pe-3", !first && "border-t-hairline border-border")} testID={`sign-in-method-${row.kind}`}>
      <View className={cn("gap-3", large ? "" : "flex-row items-center")}>
        <View className="flex-1 flex-row items-center gap-3">
          <Mark kind={row.kind} />
          <View accessible accessibilityLabel={[words.name, words.meta, words.badge].filter(Boolean).join(", ")} className="flex-1 gap-0.5">
            <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
              <Text className="text-body font-semibold text-foreground">{words.name}</Text>
              {words.badge ? (
                <View className={cn("rounded-full px-2 py-0.5", row.kind === "password" && !row.set ? "bg-muted" : "bg-tint-green")}>
                  <Text
                    className={cn(
                      "text-caption font-semibold",
                      row.kind === "password" && !row.set ? "text-muted-foreground" : "text-tint-green-foreground",
                    )}
                  >
                    {words.badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text selectable className="text-footnote leading-[18px] text-muted-foreground">
              {words.meta}
            </Text>
          </View>
        </View>
        <Pressable
          {...tap}
          accessibilityRole={web ? "link" : "button"}
          accessibilityLabel={busy ? words.busyLabel : words.actionLabel}
          accessibilityHint={reason ?? words.hint ?? undefined}
          accessibilityState={{ busy, disabled: disabled || unavailable }}
          disabled={disabled}
          onPress={() => {
            if (!busy && !unavailable) onAction();
          }}
          testID={`sign-in-method-action-${row.kind}`}
          className={cn(
            "min-h-11 flex-row items-center justify-center gap-1.5 self-start rounded-full bg-muted px-4 py-2 active:opacity-70",
            (disabled || unavailable) && "opacity-50",
          )}
        >
          {busy ? <ActivityIndicator accessibilityLabel={words.busyLabel} color={theme.foreground} /> : null}
          <Text className="text-subhead font-semibold text-foreground">{busy ? words.busyLabel : words.action}</Text>
          {web && !busy ? <Ionicons name="open-outline" size={15} color={theme.foreground} /> : null}
        </Pressable>
      </View>
      {reason ? (
        <View className="flex-row items-start gap-1.5 ps-11" testID={`sign-in-method-reason-${row.kind}`}>
          <Ionicons name="information-circle-outline" size={15} color={theme.mutedForeground} style={{ marginTop: 1 }} />
          <Text className="flex-1 text-footnote leading-[18px] text-muted-foreground">{reason}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Three rows' outlines, the rows' own height, so the card does not move when they arrive. */
export function MethodsSkeleton() {
  const { t } = useTranslation();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t("common.loading")} testID="sign-in-methods-loading">
      {[96, 120, 108].map((width, index) => (
        <View key={width} className={cn("flex-row items-center gap-3 py-3 ps-4 pe-3", index > 0 && "border-t-hairline border-border")}>
          <View className="h-8 w-8 rounded-[9px] bg-muted" />
          <View className="flex-1 gap-1.5">
            <View className="h-3.5 rounded-full bg-muted" style={{ width }} />
            <View className="h-3 w-40 rounded-full bg-muted" />
          </View>
          <View className="h-11 w-24 rounded-full bg-muted" />
        </View>
      ))}
    </View>
  );
}

/** The methods could not be read: said, announced, and read again on Retry, never guessed. */
export function MethodsLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const tap = useTapTarget(44);
  return (
    <View className="flex-row items-center gap-3 py-3 ps-4 pe-3" testID="sign-in-methods-error">
      <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="flex-1 text-callout text-destructive">
        {t("settings.security.signInMethods.loadError")}
      </Text>
      <Pressable
        {...tap}
        accessibilityRole="button"
        onPress={onRetry}
        className="min-h-11 items-center justify-center rounded-full bg-muted px-4 py-2 active:opacity-70"
      >
        <Text className="text-subhead font-semibold text-foreground">{t("settings.security.signInMethods.retry")}</Text>
      </Pressable>
    </View>
  );
}
