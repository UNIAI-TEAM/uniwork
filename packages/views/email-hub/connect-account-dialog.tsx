"use client";

import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "@uniwork/core/api/http";
import { useConnectEmailHubAccount } from "@uniwork/core/email-hub/hooks";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { ConnectAppPasswordGuideDialog } from "./connect-app-password-guide-dialog";

interface ConnectAccountDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (accountId: string) => void;
}

const FORM_ID = "email-hub-connect-form";

/** Which field a server error belongs to, so it is read out next to the thing to fix. */
function connectError(code: string | undefined): { field: "email" | "password" | "form"; key: string } {
  switch (code) {
    case "email_hub_connect_failed":
      return { field: "password", key: "email_hub.connect.error_connect_failed" };
    case "email_hub_unsupported":
      return { field: "email", key: "email_hub.connect.error_unsupported" };
    case "email_hub_not_configured":
      return { field: "form", key: "email_hub.connect.error_not_configured" };
    default:
      return { field: "form", key: "email_hub.connect.error" };
  }
}

export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected }: ConnectAccountDialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const connect = useConnectEmailHubAccount(wsId);

  const serverError = connect.isError ? connectError(errorCode(connect.error)) : null;
  const emailError = emailInvalid
    ? t("email_hub.connect.error_email_format")
    : serverError?.field === "email"
      ? t(serverError.key)
      : null;
  const passwordError = serverError?.field === "password" ? t(serverError.key) : null;
  const formError = serverError?.field === "form" ? t(serverError.key) : null;

  const close = (next: boolean) => {
    if (connect.isPending) return;
    if (!next) {
      connect.reset();
      setEmailInvalid(false);
    }
    onOpenChange(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailInvalid(true);
      document.getElementById("email-hub-email")?.focus();
      return;
    }
    // Google shows the app password in four groups of four; pasting it keeps the spaces.
    const appPassword = password.replace(/\s+/g, "");
    connect.mutate(
      { email: trimmed, appPassword },
      {
        onSuccess: (acc) => {
          if (acc) onConnected?.(acc.id);
          setEmail("");
          setPassword("");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <FormDialogContent>
          <FormDialogHeader title={t("email_hub.connect.title")} description={t("email_hub.connect.description")} />
          <FormDialogBody>
            <form id={FORM_ID} className="grid gap-4" noValidate onSubmit={submit}>
              <div className="grid gap-1.5">
                <Label htmlFor="email-hub-email">{t("email_hub.connect.email")}</Label>
                <Input
                  id="email-hub-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailInvalid(false);
                  }}
                  placeholder={t("email_hub.connect.email_placeholder")}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? "email-hub-email-error" : undefined}
                />
                {emailError ? (
                  <p id="email-hub-email-error" className="text-caption text-destructive">
                    {emailError}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email-hub-password">{t("email_hub.connect.app_password")}</Label>
                <Input
                  id="email-hub-password"
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("email_hub.connect.app_password_placeholder")}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={passwordError ? "email-hub-password-error" : "email-hub-password-hint"}
                />
                {passwordError ? (
                  <p id="email-hub-password-error" className="text-caption text-destructive">
                    {passwordError}
                  </p>
                ) : (
                  <p id="email-hub-password-hint" className="text-caption text-pretty text-muted-foreground">
                    {t("email_hub.connect.hint")}{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline underline-offset-4 hover:text-brand-subtle-foreground"
                      onClick={() => setGuideOpen(true)}
                    >
                      {t("email_hub.connect.guide.link")}
                    </button>
                  </p>
                )}
              </div>
              {formError ? (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
                  {formError}
                </p>
              ) : null}
            </form>
          </FormDialogBody>
          <FormDialogFooter
            onCancel={() => close(false)}
            submitType="submit"
            form={FORM_ID}
            submitLabel={t("email_hub.connect.submit")}
            submittingLabel={t("email_hub.connect.submitting")}
            submitting={connect.isPending}
            submitDisabled={!email.trim() || !password.trim()}
          />
        </FormDialogContent>
      </Dialog>
      <ConnectAppPasswordGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
