// The pieces of the choice screen (spec §4.3, §5.2): whose Google or Apple identity it is (the provider's mark in a
// 40 pt tile, the name, the address or "Email ẩn của Apple"), and each way to go on as one large row (a title, one
// line, a chevron) that is a single button for VoiceOver and TalkBack. A row whose step is running shows a labelled
// spinner instead of its chevron; the others dim and ignore taps.
import { Ionicons } from "@expo/vector-icons";
import type { SignInIdentity, SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import googleMark from "@/assets/google-g.png";
import { useLargeText } from "@/components/ui/a11y";
import { useRipple } from "@/components/ui/ripple";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

function ProviderMark({ provider }: { provider: SignInProvider }) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="h-10 w-10 items-center justify-center rounded-xl border border-border bg-card">
      {provider === "google" ? (
        <Image source={googleMark} style={{ width: 20, height: 20 }} contentFit="contain" accessible={false} />
      ) : (
        <Ionicons name="logo-apple" size={22} color={THEME[colorScheme].foreground} />
      )}
    </View>
  );
}

export function IdentityCard({ identity }: { identity: SignInIdentity }) {
  const { t } = useTranslation();
  const provider = t(`auth.social.provider.${identity.provider}`);
  const address = identity.private_relay ? t("auth.apple.relayEmail") : identity.email;
  const name = identity.name.trim();
  return (
    <View
      accessible
      accessibilityLabel={[t("auth.continue.identityLabel", { provider }), name, address].filter(Boolean).join(", ")}
      className="flex-row items-center gap-3 rounded-2xl border border-border px-4 py-3.5"
      testID="choice-identity"
    >
      <ProviderMark provider={identity.provider} />
      <View className="flex-1 gap-0.5">
        <Text numberOfLines={2} className="text-body font-display font-bold text-foreground">
          {name || address}
        </Text>
        {name ? (
          <Text numberOfLines={2} className="text-footnote text-muted-foreground">
            {address}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

interface ChoiceRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
  /** this row's step is running */
  busy?: boolean;
  busyLabel?: string;
  /** another row's step is running */
  disabled?: boolean;
  /** what opens under the row once chosen (the display name of a new account) */
  children?: ReactNode;
  testID?: string;
}

export function ChoiceRow({ icon, title, body, onPress, busy = false, busyLabel, disabled = false, children, testID }: ChoiceRowProps) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const ripple = useRipple();
  const large = useLargeText();
  return (
    <View className={cn("overflow-hidden rounded-2xl border border-border bg-card", disabled && "opacity-50")}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${body}`}
        accessibilityState={{ busy, disabled }}
        disabled={disabled}
        onPress={() => {
          if (!busy) onPress();
        }}
        android_ripple={ripple}
        testID={testID}
        className={cn("min-h-[72px] gap-3 px-4 py-3.5 active:bg-accent", large ? "flex-col" : "flex-row items-center")}
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Ionicons name={icon} size={20} color={theme.primary} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-body font-semibold text-foreground">{title}</Text>
          <Text className="text-footnote leading-[18px] text-muted-foreground">{body}</Text>
        </View>
        {busy ? (
          <ActivityIndicator accessibilityLabel={busyLabel ?? title} color={theme.mutedForeground} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={theme.mutedForeground} />
        )}
      </Pressable>
      {children ? <View className="gap-4 border-t border-border px-4 pb-4 pt-3.5">{children}</View> : null}
    </View>
  );
}
