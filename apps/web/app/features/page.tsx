import type { Metadata } from "next";
import { FeaturesPage } from "../../features/landing/feature-page";

export const metadata: Metadata = { title: "Các tính năng UniWork", description: "Tìm hiểu công việc, cuộc họp, trao đổi, tri thức và AI trong một workspace.", alternates: { canonical: "/features" } };
export default function Page() { return <FeaturesPage />; }
