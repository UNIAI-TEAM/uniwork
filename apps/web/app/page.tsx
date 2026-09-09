import type { Metadata } from "next";
import { LandingPage } from "../features/landing/landing-page";

export const metadata: Metadata = {
  title: "UniWork — Con người + Nhân sự AI",
  description:
    "Một nền tảng thống nhất để con người và nhân sự AI cùng trò chuyện, lập kế hoạch, " +
    "thực thi và biến tri thức thành kết quả.",
  alternates: { canonical: "/" },
};

export default function Page() {
  return <LandingPage />;
}
