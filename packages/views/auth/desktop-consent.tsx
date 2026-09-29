"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { DesktopConsent } from "@uniwork/core/api/endpoints/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Bezel } from "../layout/brand-surface";

export function DesktopConsentView({ consent, onDecision }: { consent: DesktopConsent; onDecision: (decision: "approve" | "cancel") => Promise<void> }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<"approve" | "cancel" | null>(null);
  async function decide(decision: "approve" | "cancel") {
    setPending(decision);
    try { await onDecision(decision); } finally { setPending(null); }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6">
      <Bezel>
        <section aria-labelledby="desktop-consent-title" className="flex w-full max-w-xl flex-col gap-6 p-6 sm:p-9">
          <div className="flex flex-col gap-2">
            <p className="text-overline text-muted-foreground">{t("auth.desktop.eyebrow")}</p>
            <h1 id="desktop-consent-title" className="font-display text-display font-bold text-foreground">{t("auth.desktop.title")}</h1>
            <p className="text-body text-muted-foreground">{t("auth.desktop.description")}</p>
          </div>
          <dl className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 text-body sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("auth.desktop.app")}</dt><dd className="font-semibold">{consent.client_id}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.device")}</dt><dd className="font-semibold">{consent.device_label || consent.platform}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.account")}</dt><dd className="font-semibold">{consent.account_id}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.build")}</dt><dd className="font-semibold">{consent.build || t("auth.desktop.unknown")}</dd></div>
          </dl>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void decide("cancel")}><X className="mr-2 size-4" aria-hidden />{t("common.cancel")}</Button>
            <Button type="button" disabled={pending !== null} onClick={() => void decide("approve")}><Check className="mr-2 size-4" aria-hidden />{pending === "approve" ? t("auth.desktop.approving") : t("auth.desktop.approve")}</Button>
          </div>
        </section>
      </Bezel>
    </main>
  );
}
