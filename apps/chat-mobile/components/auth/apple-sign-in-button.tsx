// Sign in with Apple on an iPhone (ADR 0041, 0047; Apple 4.8, since the screen offers Google): Apple's own system
// button, localized, accessible and approved by Apple's HIG. Black on the light screen, white on the dark one, as tall
// and as round as the buttons beside it at every text size (its title grows only with its height, so the height
// follows the text: lib/type-scale.ts › providerButtonHeight); "Continue with Apple" on the sign-in screen, "Sign up
// with Apple" on the register screen. provider-buttons.tsx decides whether Apple's sheet is offered. While another
// sign-in runs the button is dimmed and ignores taps; while its own runs it stays Apple's button, with a spinner at
// its end. In both the wrapper is what a screen reader meets, saying dimmed or busy, since the native button carries
// no such state.
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from "expo-apple-authentication";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, useWindowDimensions, View } from "react-native";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { providerButtonHeight } from "@/lib/type-scale";

/** Apple's title colour on each button style: the spinner beside it matches. */
const TITLE = { light: "#FFFFFF", dark: "#000000" } as const;

interface Props {
  signUp?: boolean;
  /** another sign-in runs */
  disabled: boolean;
  /** this one runs */
  busy?: boolean;
  onPress: () => void;
}

export function AppleSignInButton({ signUp = false, disabled, busy = false, onPress }: Props) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const height = providerButtonHeight(useWindowDimensions().fontScale);
  const idle = !disabled && !busy;
  const name = busy ? t("auth.social.signingIn") : t(signUp ? "mobile.sign_in.sign_up_with_apple" : "auth.social.continueWithApple");
  return (
    <View
      pointerEvents={idle ? "auto" : "none"}
      accessible={!idle}
      accessibilityRole={idle ? undefined : "button"}
      accessibilityLabel={idle ? undefined : name}
      accessibilityState={idle ? undefined : { disabled, busy }}
      style={{ opacity: disabled ? 0.5 : 1 }}
      testID="apple-sign-in"
    >
      <View accessibilityElementsHidden={!idle} importantForAccessibility={idle ? "auto" : "no-hide-descendants"}>
        <AppleAuthenticationButton
          buttonType={signUp ? AppleAuthenticationButtonType.SIGN_UP : AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={colorScheme === "dark" ? AppleAuthenticationButtonStyle.WHITE : AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={height / 2}
          style={{ height, width: "100%" }}
          onPress={onPress}
        />
      </View>
      {busy ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute bottom-0 right-5 top-0 justify-center"
          testID="apple-sign-in-busy"
        >
          {/* The wrapper says it is signing in: the spinner is drawn for the eye only. */}
          <ActivityIndicator accessibilityLabel={name} color={TITLE[colorScheme]} />
        </View>
      ) : null}
    </View>
  );
}
