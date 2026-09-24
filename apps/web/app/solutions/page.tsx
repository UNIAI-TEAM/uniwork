import type { Metadata } from "next";
import { SolutionsPage } from "../../features/landing/marketing-overview-pages";

export const metadata: Metadata = { title: "Giải pháp UniWork", description: "Khám phá UniWork cho nhóm sản phẩm và vận hành.", alternates: { canonical: "/solutions" } };
export default function Page() { return <SolutionsPage />; }
