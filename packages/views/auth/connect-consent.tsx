"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ShieldCheck, TriangleAlert, X } from "lucide-react";
import type { ConnectConsent } from "@uniwork/core/api/endpoints/connect";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import { Checkbox } from "@uniwork/ui/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Bezel } from "../layout/brand-surface";

export type ConnectConsentState = "pending" | "approved" | "cancelled" | "error" | "expired";

// The error code arrives in the page's query string, which anyone can write
// into a link to this trusted origin. Only a plain OAuth-style code is named
// on the page; anything else (text, markup, a phone number) reads as the
// generic error.
const PLAIN_ERROR_CODE = /^[a-z_]{1,64}$/;

type ConnectConsentProps = {
  consent: ConnectConsent | null;
  state?: ConnectConsentState;
  errorCode?: string;
  onDecision: (decision: "approve" | "cancel", organizationId?: string, write?: boolean) => Promise<void>;
  onRetry?: () => void;
};

export function ConnectConsentView({ consent, state = "pending", errorCode, onDecision, onRetry }: ConnectConsentProps) {
  const { t } = useTranslation();
  const enabled = consent?.organizations.filter((o) => o.enabled) ?? [];
  const [picked, setPicked] = useState("");
  const [allowWrite, setAllowWrite] = useState(false);
  const [pending, setPending] = useState<"approve" | "cancel" | null>(null);
  const client = consent?.client ?? null;
  const showForm = state === "pending" && consent !== null && client !== null;
  // A lone enabled organization is chosen for the person; a pick that a
  // reloaded consent no longer offers falls back to the same rule.
  const orgId = enabled.some((o) => o.id === picked) ? picked : enabled.length === 1 ? (enabled[0]?.id ?? "") : "";
  // Write is offered only when the app asked for it and the chosen organization
  // has opened it (ADR 0033); the box starts unticked and nothing ticks it for the person.
  const writeOffered = !!consent?.write_requested && enabled.some((o) => o.id === orgId && o.write_enabled);

  async function decide(decision: "approve" | "cancel") {
    if (pending !== null || (decision === "approve" && !orgId)) return;
    setPending(decision);
    try {
      await onDecision(decision, decision === "approve" ? orgId : undefined, decision === "approve" && writeOffered && allowWrite);
    } finally {
      setPending(null);
    }
  }

  const result =
    state === "approved" ? t("auth.connect.approved")
    : state === "cancelled" ? t("auth.connect.cancelled")
    : state === "expired" ? t("auth.connect.expired")
    : errorCode && PLAIN_ERROR_CODE.test(errorCode) ? t("auth.connect.errorCode", { code: errorCode })
    : t("auth.connect.error");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app-shell p-6">
      <Bezel>
        <section aria-labelledby="connect-consent-title" className="flex w-full max-w-xl flex-col gap-6 p-6 sm:p-9">
          <div className="flex flex-col gap-2">
            <p className="text-overline text-muted-foreground">{t("auth.connect.eyebrow")}</p>
            <h1 id="connect-consent-title" className="font-display text-display font-bold text-foreground">
              {showForm ? t("auth.connect.title", { client: client.name }) : t("auth.connect.resultTitle")}
            </h1>
            {showForm
              ? <p className="text-body text-muted-foreground">{t(writeOffered ? "auth.connect.descriptionWrite" : "auth.connect.description")}</p>
              : <p role="status" className="text-body text-muted-foreground">{result}</p>}
          </div>

          {showForm ? (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface p-4 text-body">
                {client.verified
                  ? <Badge className="w-fit"><ShieldCheck aria-hidden />{t("auth.connect.verified")}</Badge>
                  : <p className="flex items-start gap-2 text-destructive"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{t("auth.connect.unverifiedWarning")}</span></p>}
                <div className="flex flex-col gap-0.5">
                  <span className="text-caption text-muted-foreground">{t("auth.connect.redirectHost")}</span>
                  <span className="break-all font-semibold">{consent.redirect_host}</span>
                </div>
              </div>

              <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 text-label font-semibold">{t("auth.connect.organization")}</legend>
                {enabled.length === 0 ? <p className="text-body text-muted-foreground">{t("auth.connect.noOrganization")}</p> : null}
                <RadioGroup value={orgId} onValueChange={(value) => {
                    setPicked(String(value));
                    // A tick was given for one organization; it does not carry over to another.
                    setAllowWrite(false);
                  }} className="flex flex-col gap-2">
                  {consent.organizations.map((o) => (
                    <label key={o.id} htmlFor={`connect-org-${o.id}`} className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
                      <RadioGroupItem id={`connect-org-${o.id}`} value={o.id} disabled={!o.enabled} />
                      <span className="flex flex-col">
                        <span className="font-semibold">{o.name}</span>
                        {o.enabled ? null : <span className="text-caption text-muted-foreground">{t("auth.connect.orgDisabled")}</span>}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </fieldset>

              {writeOffered ? (
                <label htmlFor="connect-allow-write" className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
                  {/* The whole card toggles; the name is the title alone and the hint is its description. */}
                  <Checkbox
                    id="connect-allow-write"
                    checked={allowWrite}
                    onCheckedChange={(next) => setAllowWrite(next === true)}
                    aria-labelledby="connect-allow-write-title"
                    aria-describedby="connect-allow-write-hint"
                  />
                  <span className="flex flex-col">
                    <span id="connect-allow-write-title" className="font-semibold">{t("auth.connect.allowWrite")}</span>
                    <span id="connect-allow-write-hint" className="text-caption text-muted-foreground">{t("auth.connect.allowWriteHint")}</span>
                  </span>
                </label>
              ) : null}

              <div className="flex flex-col gap-1 text-body">
                <p className="font-semibold">{t("auth.connect.shares")}</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  <li>{t("auth.connect.shareTasks")}</li>
                  <li>{t("auth.connect.shareProjects")}</li>
                  <li>{t("auth.connect.shareMeetings")}</li>
                  <li>{t("auth.connect.shareNot")}</li>
                </ul>
              </div>
            </>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {showForm ? (
              <>
                <Button type="button" variant="outline" disabled={pending !== null} onClick={() => void decide("cancel")}>
                  <X className="mr-2 size-4" aria-hidden />{t("common.cancel")}
                </Button>
                <Button type="button" disabled={pending !== null || !orgId} onClick={() => void decide("approve")}>
                  <Check className="mr-2 size-4" aria-hidden />{pending === "approve" ? t("auth.connect.approving") : t("auth.connect.approve")}
                </Button>
              </>
            ) : state === "error" && onRetry ? (
              <Button type="button" onClick={onRetry}>{t("auth.connect.retry")}</Button>
            ) : null}
          </div>
        </section>
      </Bezel>
    </main>
  );
}
