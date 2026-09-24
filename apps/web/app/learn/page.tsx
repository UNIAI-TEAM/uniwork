import type { Metadata } from "next";
import { LearnPage } from "../../features/landing/marketing-overview-pages";

export const metadata: Metadata = { title: "Bắt đầu với UniWork", description: "Làm quen với workspace, công việc và trao đổi trong UniWork.", alternates: { canonical: "/learn" } };
export default function Page() { return <LearnPage />; }
