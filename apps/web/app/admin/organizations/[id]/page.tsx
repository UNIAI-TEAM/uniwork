"use client";
import { useParams } from "next/navigation";
import { AdminOrganizationDetailView } from "@uniwork/views/admin/organization-detail";

export default function AdminOrganizationPage() {
  const { id } = useParams<{ id: string }>();
  return <AdminOrganizationDetailView orgId={id} />;
}
