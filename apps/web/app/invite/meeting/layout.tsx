import type { Metadata } from "next";
import { shareMetadata } from "../../../platform/share-metadata";

// A meeting link's preview is generic on purpose: the title, host and time sit
// behind the link's secret, and a chat unfurl would print them for everyone in
// the channel. `robots` carries over from the invite layout, but its
// plain-string title ends the root's "%s · UniWork" template chain, so this
// one spells the suffix out.
export const metadata: Metadata = {
  ...shareMetadata({
    title: "You’re invited to a meeting",
    description: "Join from your browser. Notes and next steps stay with the team’s work on UniWork.",
    card: "meetingInvite",
  }),
  title: { absolute: "You’re invited to a meeting · UniWork" },
};

export default function MeetingInviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
