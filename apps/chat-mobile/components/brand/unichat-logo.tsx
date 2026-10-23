// The app icon itself (pnpm brand:build), rounded like the home screen's mask,
// so the sign-in screen shows what the person just tapped.
import { Image } from "react-native";
import icon from "@/assets/icon.png";

export function UniChatLogo({ size = 72 }: { size?: number }) {
  return (
    <Image
      source={icon}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.2237) }}
    />
  );
}
