import type { Metadata } from "next";
import { WhyPage } from "../../features/landing/why-page";

// Vietnamese for the same reason the home page's metadata is: the source
// language ships to the crawler and the page itself follows the visitor.
export const metadata: Metadata = {
  title: "Vì sao UniWork",
  description:
    "Microsoft 365, Notion, ClickUp và Coda mạnh ở bốn phía khác nhau. " +
    "Đây là khoảng trống giữa chúng, và chỗ UniWork đứng.",
  alternates: { canonical: "/why-uniwork" },
};

export default function Page() {
  return <WhyPage />;
}
