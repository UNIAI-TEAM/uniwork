import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return <Suspense>{children}</Suspense>;
}
