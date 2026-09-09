import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import { Suspense } from "react";

/**
 * The editorial serif, loaded here rather than in the root layout: the only
 * screens that render `font-serif` are the auth shell and the onboarding
 * welcome step, both inside this group. Italic ships because the welcome
 * headline uses it. A visitor who only ever sees the marketing page never
 * downloads either face.
 */
const sourceSerif = Source_Serif_4({
  subsets: ["latin", "vietnamese"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={sourceSerif.variable}>
      <Suspense>{children}</Suspense>
    </div>
  );
}
