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
      {/* A recoverable standing state, not an event: no live role, so a remount does not announce it again. */}
      <Alert variant="warning" role={undefined}>
        <CircleAlert aria-hidden />
        <AlertTitle>{t("email_hub.reconnect.banner_title")}</AlertTitle>
        {/* text-pretty: the primitive balances below md, which breaks a phone-width line early. */}
        <AlertDescription className="text-pretty">{t("email_hub.reconnect.banner_body")}</AlertDescription>
        <div className="col-start-2 mt-2">
          <Button type="button" size="sm" onClick={onReconnect}>
            <RefreshCw aria-hidden />
            {t("email_hub.reconnect.action")}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
