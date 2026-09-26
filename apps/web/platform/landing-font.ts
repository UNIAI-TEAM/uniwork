import { Be_Vietnam_Pro } from "next/font/google";

// Marketing has its own display voice with full Vietnamese coverage.
export const landingFont = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-landing",
  display: "swap",
});
