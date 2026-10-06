"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { DesktopConsent } from "@uniwork/core/api/endpoints/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Bezel } from "../layout/brand-surface";

export type DesktopConsentState = "pending" | "approved" | "cancelled" | "error" | "expired";

type DesktopConsentProps = {
  consent: DesktopConsent | null;
  state?: DesktopConsentState;
  callbackUrl?: string;
  onDecision: (decision: "approve" | "cancel") => Promise<void>;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenDesktop?: () => void;
};

export function DesktopConsentView({ consent, state = "pending", callbackUrl, onDecision, onRetry = () => undefined, onBack = () => undefined, onOpenDesktop = () => undefined }: DesktopConsentProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<"approve" | "cancel" | null>(null);
  async function decide(decision: "approve" | "cancel") {
    setPending(decision);
    try { await onDecision(decision); } finally { setPending(null); }
  }
  const resultCopy = state === "approved" ? t("auth.desktop.approved") : state === "cancelled" ? t("auth.desktop.cancelledResult") : state === "expired" ? t("auth.desktop.expired") : t("auth.desktop.errorResult");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6">
      <Bezel>
        <section aria-labelledby="desktop-consent-title" className="flex w-full max-w-xl flex-col gap-6 p-6 sm:p-9">
          <div className="flex flex-col gap-2">
            <p className="text-overline text-muted-foreground">{t("auth.desktop.eyebrow")}</p>
            <h1 id="desktop-consent-title" className="font-display text-display font-bold text-foreground">{state === "pending" ? t("auth.desktop.title") : t("auth.desktop.resultTitle")}</h1>
            {state === "pending" ? <p className="text-body text-muted-foreground">{t("auth.desktop.description")}</p> : <p role="status" className="text-body text-muted-foreground">{resultCopy}</p>}
          </div>
          {state === "pending" && consent ? <dl className="grid gap-3 rounded-xl border border-border/70 bg-surface p-4 text-body sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("auth.desktop.app")}</dt><dd className="break-words font-semibold">{consent.client_id}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.device")}</dt><dd className="break-words font-semibold">{consent.device_label || consent.platform}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.account")}</dt><dd className="break-words font-semibold">{consent.account_name || t("auth.desktop.accountUnknown")}</dd><dd className="break-words text-caption text-muted-foreground">{consent.account_email || t("auth.desktop.emailUnknown")}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.deployment")}</dt><dd className="break-words font-semibold">{consent.deployment_id}</dd></div>
            <div><dt className="text-muted-foreground">{t("auth.desktop.build")}</dt><dd className="break-words font-semibold">{consent.build || t("auth.desktop.unknown")}</dd></div>
          </dl> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {state === "pending" ? <>
            <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void decide("cancel")}><X className="mr-2 size-4" aria-hidden />{t("common.cancel")}</Button>
            <Button type="button" disabled={pending !== null} onClick={() => void decide("approve")}><Check className="mr-2 size-4" aria-hidden />{pending === "approve" ? t("auth.desktop.approving") : t("auth.desktop.approve")}</Button>
            </> : state === "approved" ? <>
              {callbackUrl ? <Button type="button" onClick={onOpenDesktop}>{t("auth.desktop.openDesktop")}</Button> : null}
              <Button type="button" variant="outline" onClick={onBack}>{t("common.close")}</Button>
            </> : state === "error" || state === "expired" ? <>
              <Button type="button" onClick={onRetry}>{t("common.retry")}</Button>
              <Button type="button" variant="outline" onClick={onBack}>{t("common.back")}</Button>
            </> : <Button type="button" variant="outline" onClick={onBack}>{t("common.back")}</Button>}
          </div>
          {state === "approved" ? <p className="text-caption text-muted-foreground">{t("auth.desktop.closeTab")}</p> : null}
        </section>
      </Bezel>
    </main>
  );
}
