"use client";

import { useState, type FormEvent } from "react";
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
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from "../common/form-dialog";
import { useOAuthPopup, type OAuthPopupOutcome } from "../integrations/use-oauth-popup";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { ConnectAppPasswordGuideSteps } from "./connect-app-password-guide-dialog";
import { connectError, oauthResultKey } from "./connect-account-errors";
import { ConnectCustomServerForm } from "./connect-custom-server-form";
import { ErrorAlert, TextField } from "./connect-form-parts";
import { ConnectMethodStep, inlineLinkClass, OAuthPendingStatus, OAuthProviderButton } from "./connect-method-step";

interface ConnectAccountDialogProps {
  wsId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: (accountId: string) => void;
  /** Where focus goes once a connect closed the dialog: its opener (a reconnect banner) may be gone with the state it showed. */
  focusAfterConnect?: () => HTMLElement | null;
  /** Reconnect this mailbox: the address is fixed; the dialog picks the way back in by the account's auth_kind and provider. */
  reconnectEmail?: string;
}

const FORM_ID = "email-hub-connect-form";
const CUSTOM_FORM_ID = "email-hub-custom-form";
type Method = "choose" | "custom" | "app_password";
const HELP_LINKS = [
  ["help_outlook", "https://support.microsoft.com/account-billing/how-to-get-and-use-app-passwords-5896ed9b-4263-e681-128a-a6f2979a7944"],
  ["help_yahoo", "https://help.yahoo.com/kb/SLN15241.html"],
] as const;

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

export function ConnectAccountDialog({
  wsId,
  open,
  onOpenChange,
  onConnected,
  focusAfterConnect,
  reconnectEmail: reconnectProp,
}: ConnectAccountDialogProps) {
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
  // The Gmail guide shows in place of the app-password form, which keeps what was typed.
  const [guideOpen, setGuideOpen] = useState(false);
  // The ids in the first list loaded after the dialog opens: the one that is new after a sign-in is what it connected.
  const [knownIds, setKnownIds] = useState<Set<string> | null>(null);
  const [didConnect, setDidConnect] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDidConnect(false);
      setMethod("choose");
      setGuideOpen(false);
      setKnownIds(null);
      setOauthError(null);
      setOauthClosed(false);
    }
  }
  const accounts = useEmailHubAccounts(wsId);
  if (open && knownIds === null && accounts.data) setKnownIds(new Set(accounts.data.accounts.map((a) => a.id)));
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
  const connect = useConnectEmailHubAccount(wsId);

  /** Every successful connect, whichever way: select the mailbox and say which one. */
  const connected = (acc: { id: string; email_address: string }) => {
    setDidConnect(true);
    onConnected?.(acc.id);
    toast.success(t("email_hub.connect.connected_toast", { email: acc.email_address }));
  };

  /**
   * After a sign-in, a fresh list says what it connected: the reconnect target once it is no longer refused, else a
   * mailbox that was not there before. A reconnect that leaves its target refused signed in as another mailbox.
   */
  const settleSignIn = async (reportedOk: boolean) => {
    const { data } = await accounts.refetch();
    const list: EmailHubAccount[] = data?.accounts ?? [];
    const added = list.find((a) => knownIds !== null && !knownIds.has(a.id));
    const fixed = list.find((a) => a.email_address === reconnectEmail && !a.needs_reconnect);
    if (reconnectEmail !== undefined && !fixed && (reportedOk || added)) {
      if (added) {
        setDidConnect(true);
        onConnected?.(added.id);
      }
      toast.info(
        added
          ? t("email_hub.reconnect.other_mailbox_named", { other: added.email_address, email: reconnectEmail })
          : t("email_hub.reconnect.other_mailbox", { email: reconnectEmail }),
      );
      onOpenChange(false);
      return;
    }
    const acc = fixed ?? added;
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
    <ErrorAlert message={t(oauthError)} />
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

  // Only the app-password form links to the guide; an OAuth reconnect shows none.
  const guide = guideOpen && form === "app_password" && !reconnectProvider;
  const title = guide
    ? t("email_hub.connect.guide.title")
    : reconnectEmail
      ? t("email_hub.reconnect.dialog_title", { email: reconnectEmail })
      : form === "custom"
        ? t("email_hub.connect.custom.title")
        : t("email_hub.connect.title");
  const description = guide
    ? t("email_hub.connect.guide.description")
    : reconnectEmail
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
  const backButton = (onClick: () => void) => (
    <Button type="button" variant="ghost" size="sm" disabled={connect.isPending} onClick={onClick}>
      {t("email_hub.connect.back")}
    </Button>
  );
  // A reconnect holds its submit until the list names the mailbox: say why, and offer a retry when the list failed.
  const reconnectNotice = !reconnectLoading ? null : accounts.isError ? (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
        {t("email_hub.connect.reconnect_load_failed")}
        <Button type="button" variant="outline" size="sm" onClick={() => void accounts.refetch()}>
          {t("common.retry")}
        </Button>
      </AlertDescription>
    </Alert>
  ) : accounts.isPending ? (
    <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
      <Spinner />
      {t("email_hub.connect.reconnect_loading")}
    </p>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <FormDialogContent finalFocus={didConnect && focusAfterConnect ? () => focusAfterConnect() ?? true : undefined}>
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
        ) : guide ? (
          <>
            <FormDialogBody>
              <ConnectAppPasswordGuideSteps />
            </FormDialogBody>
            <FormDialogFooter leading={backButton(() => setGuideOpen(false))} onCancel={() => close(false)} />
          </>
        ) : (
          <>
            <FormDialogBody>
              {reconnectNotice}
              <form id={FORM_ID} className="grid gap-4" noValidate onSubmit={submit}>
                <TextField
                  id="email-hub-email"
                  label={t("email_hub.connect.email")}
                  error={emailError}
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
                />
                <TextField
                  id="email-hub-password"
                  label={t("email_hub.connect.app_password")}
                  error={passwordError}
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("email_hub.connect.app_password_placeholder")}
                  hint={
                    <>
                      <p>{t("email_hub.connect.hint")}</p>
                      <p className="flex flex-wrap gap-x-4">
                        <button type="button" className={inlineLinkClass} onClick={() => setGuideOpen(true)}>
                          {t("email_hub.connect.guide.link")}
                        </button>
                        {HELP_LINKS.map(([key, href]) => (
                          <a key={key} href={href} target="_blank" rel="noreferrer" className={inlineLinkClass}>
                            {t(`email_hub.connect.${key}`)}
                            <span className="sr-only">{t("common.opens_new_tab")}</span>
                          </a>
                        ))}
                      </p>
                    </>
                  }
                />
                <ErrorAlert message={formError} focus />
              </form>
            </FormDialogBody>
            <FormDialogFooter
              leading={reconnectEmail === undefined ? backButton(() => pick("choose")) : undefined}
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
  );
}
