import type { Metadata } from "next";
import { shareMetadata } from "../../platform/share-metadata";

// Invite links carry a secret: keep them out of search results, like the auth
// pages. The preview names what the link is and nothing about whose it is —
// the workspace and the inviter stay behind the token.
export const metadata: Metadata = {
  ...shareMetadata({
    title: "You’re invited to join a team",
    description: "Accept the invitation to work with your teammates and AI teammates in one UniWork workspace.",
    card: "workspaceInvite",
  }),
  robots: { index: false, follow: false },
};

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
