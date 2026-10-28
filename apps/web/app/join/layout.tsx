import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join via invite link",
  robots: { index: false, follow: false },
};

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
