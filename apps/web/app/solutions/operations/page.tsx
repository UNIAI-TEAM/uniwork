import type { Metadata } from "next";
import { SolutionPage } from "../../../features/landing/solution-page";

export const metadata: Metadata = {
  title: "UniWork cho nhóm vận hành",
  description:
    "Quy trình chạy được là quy trình truy được. Hai tầng phân quyền, " +
    "nhật ký chỉ ghi thêm, và mọi việc AI làm đều hoàn tác được.",
  alternates: { canonical: "/solutions/operations" },
};

export default function Page() {
  return <SolutionPage solution="operations" />;
}
