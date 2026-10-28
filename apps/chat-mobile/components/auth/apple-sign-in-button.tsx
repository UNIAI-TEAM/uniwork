// Sign in with Apple on the sign-in screen (ADR 0041, 0047; Apple 4.8, since the sign-in offers Google).
// Apple's own system button (localized, accessible, approved by Apple's HIG): black on the light screen, white on the
// dark one, as tall and as round as the UniWork button beside it. Shown only where Apple's sheet opens (an iPhone
// that has Sign in with Apple and a server that takes it); a dimmed button ignores taps while a sign-in runs.
import { useQuery } from "@tanstack/react-query";
import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from "expo-apple-authentication";
import { View } from "react-native";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { signInOfferOptions } from "@/data/queries/sign-in";

/** the UniWork button's min-h-12 rounded-full */
const BUTTON_HEIGHT = 48;

export function AppleSignInButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const { data: offer } = useQuery(signInOfferOptions());
  if (offer?.apple !== "native") return null;
  return (
    <View pointerEvents={disabled ? "none" : "auto"} style={{ opacity: disabled ? 0.5 : 1 }} testID="apple-sign-in">
      <AppleAuthenticationButton
        buttonType={AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={colorScheme === "dark" ? AppleAuthenticationButtonStyle.WHITE : AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={BUTTON_HEIGHT / 2}
        style={{ height: BUTTON_HEIGHT, width: "100%" }}
        onPress={onPress}
      />
    </View>
  );
}
