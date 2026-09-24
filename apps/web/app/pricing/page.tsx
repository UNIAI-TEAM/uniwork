import type { Metadata } from "next";
import { PricingPage } from "../../features/landing/marketing-overview-pages";

export const metadata: Metadata = { title: "Bảng giá UniWork", description: "Thông tin gói Starter và các nhóm hạn mức của UniWork.", alternates: { canonical: "/pricing" } };
export default function Page() { return <PricingPage />; }
