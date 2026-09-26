"use client";

import { useState } from "react";
import { CalendarClock, KeyRound, Mail, Reply, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { moduleTone } from "../layout/module-tones";
import { ConnectAppPasswordGuideDialog } from "./connect-app-password-guide-dialog";

/**
 * The first screen of a workspace with no mailbox. It used to be the full
 * four-column mail client with every column empty, the stats reading 0 and the
 * only way forward a small button in the bottom-right corner.
 */
export function EmailHubConnectEmpty({ aiEnabled, onConnect }: { aiEnabled: boolean; onConnect: () => void }) {
  const { t } = useTranslation();
  const [guideOpen, setGuideOpen] = useState(false);
  const points = [
    { icon: Reply, key: "email_hub.onboarding.point_read" },
    { icon: CalendarClock, key: "email_hub.onboarding.point_schedule" },
    ...(aiEnabled ? [{ icon: Sparkles, key: "email_hub.onboarding.point_ai" }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-lg">
        <IconTile icon={Mail} tone={moduleTone("email")} />
        <h1 className="mt-5 text-title-lg font-semibold text-balance">{t("email_hub.onboarding.title")}</h1>
        <p className="mt-2 text-body text-pretty text-muted-foreground">{t("email_hub.onboarding.body")}</p>
        <ul className="mt-6 space-y-3">
          {points.map(({ icon: Icon, key }) => (
            <li key={key} className="flex items-start gap-3 text-body">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="text-pretty">{t(key)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button type="button" variant="brand" size="lg" onClick={onConnect}>
            <Mail aria-hidden />
            {t("email_hub.onboarding.connect")}
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={() => setGuideOpen(true)}>
            <KeyRound aria-hidden />
            {t("email_hub.connect.guide.title")}
          </Button>
        </div>
      </div>
      <ConnectAppPasswordGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

/** While the mailboxes load: the shape of the mail client, not a spinner. */
export function EmailHubShellSkeleton() {
  return (
    <div className="flex min-h-0 flex-1" aria-busy="true">
      <div className="hidden w-60 shrink-0 space-y-3 border-r border-border bg-sidebar p-3 lg:block">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <Skeleton className="h-9 w-full max-w-md" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
