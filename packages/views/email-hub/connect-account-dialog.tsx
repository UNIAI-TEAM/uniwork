"use client";

import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useConnectEmailHubAccount,
  useEmailHubAccounts,
  useEmailHubProviders,
  useStartEmailHubOAuth,
} from "@uniwork/core/email-hub/hooks";
import type { EmailHubAccount, EmailHubOAuthProvider } from "@uniwork/core/types/email-hub";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { useOAuthPopup, type OAuthPopupOutcome } from "../integrations/use-oauth-popup";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { ConnectAppPasswordGuideDialog } from "./connect-app-password-guide-dialog";
import { connectError, oauthResultKey } from "./connect-account-errors";
import { ConnectCustomServerForm } from "./connect-custom-server-form";
import { ConnectMethodStep, inlineLinkClass, OAuthPendingStatus, OAuthProviderButton } from "./connect-method-step";

interface ConnectAccountDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (accountId: string) => void;
  /** Reconnect this mailbox: the address is fixed; the dialog picks the way back in by the account's auth_kind and provider. */
  reconnectEmail?: string;
}

const FORM_ID = "email-hub-connect-form";
const CUSTOM_FORM_ID = "email-hub-custom-form";
type Method = "choose" | "custom" | "app_password";

/** The provider an OAuth mailbox signs in again with; null for a password mailbox. */
function oauthProviderOf(authKind: string | undefined): EmailHubOAuthProvider | null {
  switch (authKind) {
    case "oauth_google":
      return "google";
    case "oauth_microsoft":
      return "microsoft";
    default:
      return null;
  }
}

export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected, reconnectEmail: reconnectProp }: ConnectAccountDialogProps) {
  const { t } = useTranslation();
  // Hosts clear the address as they close; keep the reconnect form on screen until the exit animation ends.
  const [reconnectEmail, setReconnectEmail] = useState(reconnectProp);
  if (open && reconnectProp !== reconnectEmail) setReconnectEmail(reconnectProp);
  // An i18n key: the OAuth result comes from the popup, outside any mutation's error state.
  const [oauthError, setOauthError] = useState<string | null>(null);
  // The popup closed with no message and the list shows nothing connected: a note, not an error.
  const [oauthClosed, setOauthClosed] = useState(false);
  // Reset the step as the dialog opens, not as it closes, so the closing dialog keeps the form it showed.
  const [method, setMethod] = useState<Method>("choose");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMethod("choose");
      setOauthError(null);
      setOauthClosed(false);
    }
  }
  const accounts = useEmailHubAccounts(wsId);
  const providers = useEmailHubProviders(wsId);
  const startOAuth = useStartEmailHubOAuth(wsId);
  const reconnectAccount =
    reconnectEmail === undefined ? undefined : accounts.data?.accounts.find((acc) => acc.email_address === reconnectEmail);
  // A reconnect skips the step: an OAuth mailbox signs in again with its provider, a custom-server one reopens its
  // settings; any other (or one not loaded yet) asks for the app password.
  const reconnectProvider = oauthProviderOf(reconnectAccount?.auth_kind);
  const form: Method =
    reconnectEmail === undefined ? method : reconnectAccount?.provider === "custom" ? "custom" : "app_password";
  // Until the account is known (list loading, failed or without it), a custom mailbox could be showing the wrong form: hold the submit.
  const reconnectLoading = reconnectEmail !== undefined && !reconnectAccount;
  const [email, setEmail] = useState("");
  const address = reconnectEmail ?? email;
  const [password, setPassword] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const connect = useConnectEmailHubAccount(wsId);

  // The ids on screen as a sign-in starts: the one that is new afterwards is the mailbox it connected.
  const knownIds = useRef<Set<string> | null>(null);

  /** Every successful connect, whichever way: select the mailbox and say which one. */
  const connected = (acc: { id: string; email_address: string }) => {
    onConnected?.(acc.id);
    toast.success(t("email_hub.connect.connected_toast", { email: acc.email_address }));
  };

  /**
   * After a sign-in, a fresh list says what it connected: a mailbox that was not there before, else the reconnect
   * target — taken on the popup's word when it said ok, only once fixed when it closed without a message.
   */
  const settleSignIn = async (reportedOk: boolean) => {
    const { data } = await accounts.refetch();
    const list: EmailHubAccount[] = data?.accounts ?? [];
    const known = knownIds.current;
    const acc =
      list.find((a) => known !== null && !known.has(a.id)) ??
      list.find((a) => a.email_address === reconnectEmail && (reportedOk || !a.needs_reconnect));
    if (acc) connected(acc);
    if (acc || reportedOk) onOpenChange(false);
    else setOauthClosed(true);
  };

  const onOAuthOutcome = (outcome: OAuthPopupOutcome) => {
    switch (outcome.kind) {
      case "message":
        if (outcome.ok) void settleSignIn(true);
        else setOauthError(oauthResultKey(outcome.code));
        return;
      case "closed":
        // Closed without a message (cancelled, or the message was lost): the list says whether it connected.
        void settleSignIn(false);
        return;
      case "blocked":
        setOauthError("email_hub.connect.error_popup_blocked");
        return;
      default:
        setOauthError("email_hub.connect.error_oauth_failed");
    }
  };
  const popup = useOAuthPopup({ name: "uniwork-email-oauth", messageType: "uniwork:email-hub-oauth", onOutcome: onOAuthOutcome });

  const signIn = (provider: EmailHubOAuthProvider) => {
    setOauthError(null);
    setOauthClosed(false);
    knownIds.current = accounts.data ? new Set(accounts.data.accounts.map((a) => a.id)) : null;
    // login_hint preselects the mailbox being reconnected; the server connects whichever account the user actually picks.
    popup.open(() => startOAuth.mutateAsync({ provider, loginHint: reconnectEmail }));
  };

  const serverError = connect.isError ? connectError(connect.error) : null;
  const emailError = emailInvalid
    ? t("email_hub.connect.error_email_format")
    : serverError?.field === "email"
      ? t(serverError.key)
      : null;
  const passwordError = serverError?.field === "password" ? t(serverError.key) : null;
  // The app-password form has no server fields; any other field's error reads for the whole form.
  const formError = serverError && serverError.field !== "email" && serverError.field !== "password" ? t(serverError.key) : null;
  const oauthNotice = popup.pending ? (
    <OAuthPendingStatus onShowWindow={popup.focus} />
  ) : oauthError ? (
    <p className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
      {t(oauthError)}
    </p>
  ) : oauthClosed ? (
    <Alert role="status">
      <AlertDescription className="text-caption">{t("email_hub.connect.oauth_closed")}</AlertDescription>
    </Alert>
  ) : null;

  const close = (next: boolean) => {
    if (connect.isPending) return;
    if (!next) {
      connect.reset();
      setEmailInvalid(false);
      // The dialog stays mounted: a cancelled app password must not wait in state for the next open.
      setPassword("");
    }
    onOpenChange(next);
  };

  const pick = (next: Method) => {
    // An error from one form must not show up on the other.
    connect.reset();
    setEmailInvalid(false);
    setOauthError(null);
    setOauthClosed(false);
    setMethod(next);
  };

  const run = (input: Parameters<typeof connect.mutate>[0]) =>
    connect.mutate(input, {
      onSuccess: (acc) => {
        if (acc) connected(acc);
        setEmail("");
        setPassword("");
        onOpenChange(false);
      },
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reconnectLoading) return;
    const trimmed = address.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailInvalid(true);
      document.getElementById("email-hub-email")?.focus();
      return;
    }
    // Google shows the app password in four groups of four; pasting it keeps the spaces.
    run({ email: trimmed, appPassword: password.replace(/\s+/g, "") });
  };

  const title = reconnectEmail
    ? t("email_hub.reconnect.dialog_title", { email: reconnectEmail })
    : form === "custom"
      ? t("email_hub.connect.custom.title")
      : t("email_hub.connect.title");
  const description = reconnectEmail
    ? reconnectProvider
      ? t("email_hub.reconnect.dialog_description_oauth")
      : form === "custom"
        ? t("email_hub.reconnect.dialog_description_custom")
        : t("email_hub.reconnect.dialog_description")
    : form === "custom"
      ? t("email_hub.connect.custom.description")
      : form === "app_password"
        ? t("email_hub.connect.description")
        : t("email_hub.connect.method_description");

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <FormDialogContent>
          <FormDialogHeader title={title} description={description} />
          {form === "choose" ? (
            <>
              <FormDialogBody>
                <ConnectMethodStep
                  providers={providers.data}
                  providersLoading={providers.isPending}
                  pending={popup.pending}
                  onPick={pick}
                  onOAuth={signIn}
                />
                {oauthNotice}
              </FormDialogBody>
              <FormDialogFooter onCancel={() => close(false)} />
            </>
          ) : reconnectProvider ? (
            <>
              <FormDialogBody>
                <OAuthProviderButton
                  provider={reconnectProvider}
                  pending={popup.pending}
                  onClick={() => signIn(reconnectProvider)}
                />
                {oauthNotice}
              </FormDialogBody>
              <FormDialogFooter onCancel={() => close(false)} />
            </>
          ) : form === "custom" ? (
            <ConnectCustomServerForm
              // initial is read at mount: a different mailbox, or a fresh connect, starts a fresh form.
              key={reconnectAccount?.id ?? "new"}
              formId={CUSTOM_FORM_ID}
              initial={reconnectAccount}
              pending={connect.isPending}
              error={connect.isError ? connect.error : null}
              onCancel={() => close(false)}
              onBack={reconnectEmail === undefined ? () => pick("choose") : undefined}
              onSubmit={run}
            />
          ) : (
            <>
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
                      value={address}
                      readOnly={reconnectEmail !== undefined}
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
                        <button type="button" className={inlineLinkClass} onClick={() => setGuideOpen(true)}>
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
                leading={
                  reconnectEmail === undefined ? (
                    <Button type="button" variant="ghost" size="sm" disabled={connect.isPending} onClick={() => pick("choose")}>
                      {t("email_hub.connect.back")}
                    </Button>
                  ) : undefined
                }
                onCancel={() => close(false)}
                submitType="submit"
                form={FORM_ID}
                submitLabel={reconnectEmail ? t("email_hub.reconnect.action") : t("email_hub.connect.submit")}
                submittingLabel={t("email_hub.connect.submitting")}
                submitting={connect.isPending}
                submitDisabled={!address.trim() || !password.trim() || reconnectLoading}
              />
            </>
          )}
        </FormDialogContent>
      </Dialog>
      <ConnectAppPasswordGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}
