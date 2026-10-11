"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";

/** Shown over the cached list while the mailbox's login is refused; synced mail stays readable below. */
export function EmailHubReconnectBanner({ onReconnect }: { onReconnect: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-3 pt-3 lg:px-4">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>{t("email_hub.reconnect.banner_title")}</AlertTitle>
        <AlertDescription>{t("email_hub.reconnect.banner_body")}</AlertDescription>
        <div className="col-start-2 mt-2">
          <Button type="button" size="sm" variant="outline" onClick={onReconnect}>
            <RefreshCw aria-hidden />
            {t("email_hub.reconnect.action")}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
