"use client";

import { useTranslation } from "react-i18next";
import { Badge } from "@uniwork/ui/components/ui/badge";

function tone(status: string): "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
      return "secondary";
    case "suspended":
      return "destructive";
    default:
      return "outline";
  }
}

/** active / suspended / archived as a badge; an unknown status renders its raw name. */
export function OrganizationStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "admin.organizations.status" });
  return <Badge variant={tone(status)}>{t(status, { defaultValue: status })}</Badge>;
}

/** ISO → locale date, "" when unparseable; a null is the caller's "never". */
export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(locale);
}
