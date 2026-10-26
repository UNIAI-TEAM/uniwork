"use client";

import { MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { useOfficeHomeLaunch, type OfficeHomeLaunchProps } from "./use-office-home-launch";

export type { OfficeHomeLaunchProps } from "./use-office-home-launch";

/**
 * Opens the installed UniWork Office on its home screen through the app's
 * registered scheme. When the browser saw no hand-off (the app is missing or
 * did not answer) the same installer dialog as "Open in UniWork Office"
 * opens. Hidden until the platform is known, and for good on a device no
 * installer exists for (phones, tablets).
 */
export function OfficeHomeLaunch(props: OfficeHomeLaunchProps) {
  const { t } = useTranslation();
  const { status, launching, run, prompt } = useOfficeHomeLaunch(props);

  if (status !== "available") return null;

  const label = t("documents.home.open_office");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("max-sm:px-2", props.className)}
        aria-label={label}
        aria-busy={launching || undefined}
        aria-disabled={launching || undefined}
        onClick={() => void run()}
        data-office-home-launch
      >
        {launching ? <Spinner aria-hidden role="presentation" /> : <MonitorUp aria-hidden />}
        <span className="max-sm:sr-only">{label}</span>
      </Button>
      {prompt}
    </>
  );
}
