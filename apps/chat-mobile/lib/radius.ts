// Ported from usf apps/mobile/lib/radius.ts. radius-tokens.json holds the
// --radius-* ladder of packages/ui/styles/tokens.css in px, because React
// Native cannot read the web CSS custom properties.
import type { ViewStyle } from "react-native";
import radiusTokens from "./radius-tokens.json";

/** Shared by NativeWind utilities (tailwind.config.js) and inline styles. */
export const MOBILE_RADIUS = radiusTokens;

/** iOS-style continuous curves for surfaces with large corner radii. */
export const continuousCorners = {
  borderCurve: "continuous",
} satisfies ViewStyle;
