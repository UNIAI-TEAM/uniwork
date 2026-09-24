import type { Metadata } from "next";
import { EnterprisePage } from "../../features/landing/marketing-overview-pages";

export const metadata: Metadata = { title: "UniWork cho doanh nghiệp", description: "Tìm hiểu cấu trúc tổ chức, phân quyền và nhật ký hoạt động.", alternates: { canonical: "/enterprise" } };
export default function Page() { return <EnterprisePage />; }
