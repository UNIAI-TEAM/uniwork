// The Apple and Google buttons above the email form of the sign-in and register screens (ADR 0047, spec §5.2), then
// "hoặc dùng email". Each provider is offered as the server and this phone allow (data/queries/sign-in.ts): its own
// sheet, or the browser with the provider hint, or not at all. On an iPhone, Apple's system button comes first
// (Apple's HIG; Apple 4.8 since Google is offered); on Android, Google first and Apple as a black or white pill that
// signs in through the browser. Google's button follows Google's branding: the four-colour mark as an image on a
// white or near-black pill with its stroke. They are one height at every text size, 48 pt at the default one, so
// they stay equally prominent (lib/type-scale.ts › providerButtonHeight: Apple's title grows only with its height,
// and a pill's one-line label shrinks to fit rather than wrap). While the offer loads, grey pills of that height hold
// the place so the form does not jump; a button whose sign-in runs keeps its mark and its words (both brands ask for
// them) with a spinner at its end and says it is signing in, and the others dim and ignore taps.
import { Ionicons } from "@expo/vector-icons";
import type { NativeSignInIntent } from "@uniwork/core/api/endpoints/sign-in-native-api";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Platform, Pressable, useWindowDimensions, View } from "react-native";
import googleMark from "@/assets/google-g.png";
import { useTapTarget } from "@/components/ui/tap-target";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import type { SignInRequest } from "@/data/auth/sign-in";
import { signInOfferOptions } from "@/data/queries/sign-in";
import { providerOrder, providerRequest } from "@/lib/sign-in-offer";
import { PROVIDER_BUTTON_MAX_FONT_SCALE, providerButtonHeight } from "@/lib/type-scale";
import { cn } from "@/lib/utils";
import { AppleSignInButton } from "./apple-sign-in-button";
import { OrDivider } from "./auth-layout";

/** Google's branding colours for its button (developers.google.com/identity/branding-guidelines), not theme tokens. */
const GOOGLE = {
  light: { fill: "#FFFFFF", stroke: "#747775", text: "#1F1F1F" },
  dark: { fill: "#131314", stroke: "#8E918F", text: "#E3E3E3" },
} as const;
/** Apple's own palette for a button it does not draw (Apple's HIG): black on the light screen, white on the dark. */
const APPLE = {
  light: { fill: "#000000", text: "#FFFFFF" },
  dark: { fill: "#FFFFFF", text: "#000000" },
} as const;

interface PillProps {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: { fill: string; text: string; stroke?: string };
  mark: ReactNode;
  testID: string;
}

function ProviderPill({ label, busyLabel, busy, disabled, onPress, colors, mark, testID }: PillProps) {
  const tap = useTapTarget(48);
  const height = providerButtonHeight(useWindowDimensions().fontScale);
  return (
    <Pressable
      {...tap}
      accessibilityRole="button"
      accessibilityLabel={busy ? busyLabel : label}
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={() => {
        if (!busy) onPress();
      }}
      testID={testID}
      style={{ minHeight: height, backgroundColor: colors.fill, borderColor: colors.stroke ?? colors.fill, borderWidth: 1 }}
      // px-11 keeps the centred mark and words clear of the spinner at the end.
      className={cn("flex-row items-center justify-center gap-2.5 rounded-full px-11 py-3 active:opacity-80", disabled && "opacity-50")}
    >
      {mark}
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={PROVIDER_BUTTON_MAX_FONT_SCALE}
        style={{ color: colors.text }}
        className="shrink text-center text-body font-semibold"
      >
        {label}
      </Text>
      {busy ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute bottom-0 right-5 top-0 justify-center"
          testID={`${testID}-busy`}
        >
          {/* The pill's own label says it is signing in: the spinner is drawn for the eye only. */}
          <ActivityIndicator accessibilityLabel={busyLabel} color={colors.text} />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * One provider's pill, in its own brand's colours and mark: Google's, and Apple's where the system's button is not
 * drawn (the browser on Android). The proof sheet's Google button is one too.
 */
export function ProviderButton({
  provider,
  ...pill
}: { provider: SignInProvider } & Omit<PillProps, "colors" | "mark">) {
  const { colorScheme } = useColorScheme();
  if (provider === "apple") {
    const colors = APPLE[colorScheme];
    return <ProviderPill {...pill} colors={colors} mark={<Ionicons name="logo-apple" size={20} color={colors.text} />} />;
  }
  return (
    <ProviderPill
      {...pill}
      colors={GOOGLE[colorScheme]}
      mark={<Image source={googleMark} style={{ width: 20, height: 20 }} contentFit="contain" accessible={false} />}
    />
  );
}

interface Props {
  /** "sign_up" on the register screen: an account at once, never the choice screen */
  intent?: NativeSignInIntent;
  /** the control a sign-in is running from ("apple", "google" here; any other dims these) */
  busy: string | null;
  /** the provider whose identity waits to be linked: its button would only start it again (spec §4.4) */
  hidden?: SignInProvider | null;
  onStart: (request: SignInRequest, provider: SignInProvider) => void;
}

export function ProviderButtons({ intent, busy, hidden = null, onStart }: Props) {
  const { t } = useTranslation();
  const { data: offer, isPending } = useQuery(signInOfferOptions());
  const height = providerButtonHeight(useWindowDimensions().fontScale);

  if (isPending) {
    return (
      <View className="gap-3" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="provider-buttons-loading">
        <View style={{ minHeight: height }} className="rounded-full bg-muted" />
        <View style={{ minHeight: height }} className="rounded-full bg-muted" />
        <OrDivider label={t("auth.social.divider")} />
      </View>
    );
  }
  const shown = providerOrder(Platform.OS).flatMap((provider) => {
    const request = provider === hidden ? null : providerRequest(provider, offer, intent);
    return request ? [{ provider, request }] : [];
  });
  if (shown.length === 0) return null;

  return (
    <View className="gap-3" testID="provider-buttons">
      {shown.map(({ provider, request }) => {
        const disabled = busy !== null && busy !== provider;
        const start = () => onStart(request, provider);
        if (provider === "apple" && request.method === "apple") {
          return <AppleSignInButton key={provider} signUp={intent === "sign_up"} disabled={disabled} busy={busy === "apple"} onPress={start} />;
        }
        return (
          <ProviderButton
            key={provider}
            provider={provider}
            label={t(provider === "apple" ? "auth.social.continueWithApple" : "auth.social.continueWithGoogle")}
            busyLabel={t("auth.social.signingIn")}
            busy={busy === provider}
            disabled={disabled}
            onPress={start}
            testID={provider === "apple" ? "apple-browser-sign-in" : "google-sign-in"}
          />
        );
      })}
      <OrDivider label={t("auth.social.divider")} />
    </View>
  );
}
