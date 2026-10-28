// Sign in with Apple on an iPhone (ADR 0041, 0047; Apple 4.8, since the screen offers Google): Apple's own system
// button, localized, accessible and approved by Apple's HIG. Black on the light screen, white on the dark one, as tall
// and as round as the buttons beside it; "Continue with Apple" on the sign-in screen, "Sign up with Apple" on the
// register screen. provider-buttons.tsx decides whether Apple's sheet is offered; a dimmed button ignores taps while
// another sign-in runs.
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from "expo-apple-authentication";
import { View } from "react-native";
import { useColorScheme } from "@/components/ui/use-color-scheme";

/** the provider pills' min-h-12 rounded-full */
const BUTTON_HEIGHT = 48;

export function AppleSignInButton({ signUp = false, disabled, onPress }: { signUp?: boolean; disabled: boolean; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  return (
    <View pointerEvents={disabled ? "none" : "auto"} style={{ opacity: disabled ? 0.5 : 1 }} testID="apple-sign-in">
      <AppleAuthenticationButton
        buttonType={signUp ? AppleAuthenticationButtonType.SIGN_UP : AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={colorScheme === "dark" ? AppleAuthenticationButtonStyle.WHITE : AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={BUTTON_HEIGHT / 2}
        style={{ height: BUTTON_HEIGHT, width: "100%" }}
        onPress={onPress}
      />
    </View>
  );
}
