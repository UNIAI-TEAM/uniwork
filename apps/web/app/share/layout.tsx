import type { Metadata } from "next";
import { shareMetadata } from "../../platform/share-metadata";

// The token is the whole credential for a public document, so the page stays
// out of search results and the preview never names the document.
export const metadata: Metadata = {
  ...shareMetadata({
    title: "A document shared with you",
    description: "Open it in your browser to read. No account needed.",
    card: "sharedDocument",
  }),
  robots: { index: false, follow: false },
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
