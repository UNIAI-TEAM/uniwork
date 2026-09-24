"use client";

import type { ReactNode } from "react";
import { Copy, ExternalLink, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button, ButtonLink } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { cn } from "@uniwork/ui/lib/utils";

const GOOGLE_2SV_URL = "https://myaccount.google.com/signinoptions/two-step-verification";
const GOOGLE_APP_PASSWORDS_URL = "https://myaccount.google.com/apppasswords";

function GuideStep({
  step,
  title,
  children,
  visual,
}: {
  step: number;
  title: string;
  children: ReactNode;
  visual: ReactNode;
}) {
  return (
    <li className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-start">
      <div className="space-y-2">
        <p className="text-overline text-muted-foreground">{step.toString().padStart(2, "0")}</p>
        <h3 className="text-body font-medium text-foreground">{title}</h3>
        <div className="space-y-2 text-caption text-muted-foreground">{children}</div>
      </div>
      <div className="flex justify-center sm:justify-end">{visual}</div>
    </li>
  );
}

function MockToggle({ on }: { on: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative h-6 w-11 rounded-full transition-colors",
        on ? "bg-brand" : "bg-muted-foreground/30",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </div>
  );
}

function MockSecurityRow({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-caption">
      <span className="min-w-0 text-foreground">{label}</span>
      {active ? <MockToggle on /> : <span className="text-muted-foreground">›</span>}
    </div>
  );
}

function MockAppPasswordForm({ mailLabel, deviceLabel, passwordSample }: {
  mailLabel: string;
  deviceLabel: string;
  passwordSample: string;
}) {
  return (
    <div aria-hidden className="w-full max-w-[12rem] space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="rounded-md border border-border px-2 py-1.5 text-caption text-muted-foreground">{mailLabel}</div>
      <div className="rounded-md border border-border px-2 py-1.5 text-caption text-muted-foreground">{deviceLabel}</div>
      <div className="rounded-md bg-brand-subtle px-2 py-1.5 text-center font-mono text-caption font-medium tracking-wider text-brand-subtle-foreground">
        {passwordSample}
      </div>
    </div>
  );
}

interface ConnectAppPasswordGuideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectAppPasswordGuideDialog({ open, onOpenChange }: ConnectAppPasswordGuideDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl" closeLabel={t("common.close")}>
        <DialogHeader className="space-y-2 border-b border-border px-4 py-4 text-left">
          <DialogTitle>{t("email_hub.connect.guide.title")}</DialogTitle>
          <DialogDescription>{t("email_hub.connect.guide.description")}</DialogDescription>
        </DialogHeader>

        <ol className="max-h-[min(70vh,560px)] space-y-3 overflow-y-auto px-4 py-4">
          <GuideStep
            step={1}
            title={t("email_hub.connect.guide.step1_title")}
            visual={
              <div className="w-full max-w-[12rem] space-y-2 rounded-lg border border-border bg-background p-3">
                <MockSecurityRow label={t("email_hub.connect.guide.mock_2sv")} active />
              </div>
            }
          >
            <p>{t("email_hub.connect.guide.step1_body")}</p>
            <a
              href={GOOGLE_2SV_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
            >
              {t("email_hub.connect.guide.open_2sv")}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </GuideStep>

          <GuideStep
            step={2}
            title={t("email_hub.connect.guide.step2_title")}
            visual={
              <div className="flex size-16 items-center justify-center rounded-lg bg-brand-subtle text-brand-subtle-foreground">
                <ShieldCheck className="size-8" aria-hidden />
              </div>
            }
          >
            <p>{t("email_hub.connect.guide.step2_body")}</p>
          </GuideStep>

          <GuideStep
            step={3}
            title={t("email_hub.connect.guide.step3_title")}
            visual={
              <MockAppPasswordForm
                mailLabel={t("email_hub.connect.guide.mock_mail")}
                deviceLabel={t("email_hub.connect.guide.mock_device")}
                passwordSample={t("email_hub.connect.guide.mock_password_sample")}
              />
            }
          >
            <p>{t("email_hub.connect.guide.step3_body")}</p>
            <a
              href={GOOGLE_APP_PASSWORDS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4"
            >
              {t("email_hub.connect.guide.open_app_passwords")}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </GuideStep>

          <GuideStep
            step={4}
            title={t("email_hub.connect.guide.step4_title")}
            visual={
              <div className="flex size-16 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground">
                <Copy className="size-7" aria-hidden />
              </div>
            }
          >
            <p>{t("email_hub.connect.guide.step4_body")}</p>
          </GuideStep>
        </ol>

        <DialogFooter className="gap-2 border-t border-border bg-muted/20 px-4 py-3 sm:justify-between">
          <p className="flex items-center gap-2 text-caption text-muted-foreground">
            <KeyRound className="size-4 shrink-0" aria-hidden />
            {t("email_hub.connect.guide.footer")}
          </p>
          <div className="flex gap-2">
            <ButtonLink href={GOOGLE_APP_PASSWORDS_URL} target="_blank" rel="noopener noreferrer" variant="outline">
              <Mail className="size-4" aria-hidden />
              {t("email_hub.connect.guide.open_app_passwords")}
            </ButtonLink>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t("email_hub.connect.guide.done")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
