import type { Metadata } from "next";

// Invite links carry a secret and lead to a single meeting: keep them out of
// search results, like the auth pages.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
