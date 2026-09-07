"use client";
import { AdminLayout } from "@uniwork/views/admin/layout";

/** Route wiring only: the console shell (nav + GET /admin/me gate) lives in views. */
export default function AdminRouteLayout({ children }: { children: React.ReactNode }) {
  return <AdminLayout>{children}</AdminLayout>;
}
