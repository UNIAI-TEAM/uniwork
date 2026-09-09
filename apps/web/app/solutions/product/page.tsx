import type { Metadata } from "next";
import { SolutionPage } from "../../../features/landing/solution-page";

// Metadata is Vietnamese here for the same reason the home page's is: the
// source language ships to the crawler, and the page itself switches with the
// visitor's locale.
export const metadata: Metadata = {
  title: "UniWork cho nhóm sản phẩm",
  description:
    "Từ cuộc họp tới việc đã giao, không mất ngữ cảnh ở giữa. " +
    "Agent tham gia bảng việc như một thành viên.",
  alternates: { canonical: "/solutions/product" },
};

export default function Page() {
  return <SolutionPage solution="product" />;
}
