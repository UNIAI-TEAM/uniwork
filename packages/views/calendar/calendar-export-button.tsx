"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  WORKSPACE_ICS_FILENAME,
  fetchWorkspaceCalendarIcs,
} from "@uniwork/core/api/endpoints/calendar";
import { Button } from "@uniwork/ui/components/ui/button";
import { toastApiError } from "../toast-api-error";

function downloadCalendar(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CalendarExportButton({
  workspaceId,
  from,
  to,
  className,
}: {
  workspaceId: string;
  from?: string;
  to?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void fetchWorkspaceCalendarIcs(workspaceId, { from, to })
          .then((ics) => {
            downloadCalendar(WORKSPACE_ICS_FILENAME, ics);
            toast.success(t("calendar.export_ics"));
          })
          .catch((err) => toastApiError(err, t("calendar.export_ics_error")))
          .finally(() => setPending(false));
      }}
    >
      <Download aria-hidden className="size-4" />
      {t("calendar.export_ics")}
    </Button>
  );
}
