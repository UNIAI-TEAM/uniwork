"use client";

import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import type { ShareMembersError } from "./use-share-members";

/**
 * The one line the share dialog shows when the member walk did not finish
 * (UNI-1778). `Alert` carries `role="alert"`, so a screen reader hears it once
 * when it appears. The page-bound case has no Retry: another try would walk
 * the same 40 pages and stop at the same place.
 */
export function ShareMembersErrorLine({
  error,
  retrying,
  onRetry,
}: {
  error: ShareMembersError;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive" className="flex items-start justify-between gap-2">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <AlertDescription className="min-w-0 flex-1">
        {t(`documents.share.members_error_${error}`)}
      </AlertDescription>
      {error === "limit" ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={retrying}
          aria-busy={retrying || undefined}
          onClick={onRetry}
        >
          {retrying ? <Spinner aria-hidden role="presentation" /> : null}
          {t("documents.share.retry")}
        </Button>
      )}
    </Alert>
  );
}
