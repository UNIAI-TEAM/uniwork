"use client";

import { Fragment, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount, EmailHubCustomServer } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { FormDialogBody, FormDialogFooter } from "../common/form-dialog";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { connectError, type ConnectErrorField } from "./connect-account-errors";
import { ErrorAlert, TextField } from "./connect-form-parts";
import { inlineLinkClass } from "./connect-method-step";

type EmailHubServerSecurity = EmailHubCustomServer["imap_security"];
type Side = "imap" | "smtp";
/** i18n keys of the client-side checks, by field. */
type FieldErrors = Partial<Record<ConnectErrorField, string>>;

interface ServerDraft {
  host: string;
  port: string;
  security: EmailHubServerSecurity;
  /** Set once the port is typed by hand; from then on a security change leaves it alone. */
  portEdited: boolean;
}

const SIDES: readonly Side[] = ["imap", "smtp"];
const SECURITIES: readonly EmailHubServerSecurity[] = ["tls", "starttls"];
const DEFAULT_SECURITY: Record<Side, EmailHubServerSecurity> = { imap: "tls", smtp: "starttls" };
const DEFAULT_PORT: Record<Side, Record<EmailHubServerSecurity, number>> = {
  imap: { tls: 993, starttls: 143 },
  smtp: { tls: 465, starttls: 587 },
};
// Integer format only; the server owns the allowed port set and answers email_hub_invalid_server on the field.
const PORT_RE = /^\d{1,5}$/;
/** Focus goes to the first of these that failed a client check. */
const FIELD_ORDER: readonly ConnectErrorField[] = ["email", "password", "imap_host", "imap_port", "smtp_host", "smtp_port"];

// email-hub-custom-password is also the reconnect dialog's initial focus (connect-account-dialog.tsx).
const fieldId = (field: ConnectErrorField) => `email-hub-custom-${field}`;
/** One port hint under both server sections; each security choice points to it. */
const SECURITY_HINT_ID = "email-hub-custom-security-hint";

function initialDraft(side: Side, account: EmailHubAccount | undefined): ServerDraft {
  const saved = side === "imap" ? account?.imap_security : account?.smtp_security;
  const security = saved === "tls" || saved === "starttls" ? saved : DEFAULT_SECURITY[side];
  const host = (side === "imap" ? account?.imap_host : account?.smtp_host) ?? "";
  const port = (side === "imap" ? account?.imap_port : account?.smtp_port) ?? DEFAULT_PORT[side][security];
  return { host, port: String(port), security, portEdited: false };
}

function ServerFieldset({
  side,
  draft,
  onChange,
  errorFor,
  clear,
}: {
  side: Side;
  draft: ServerDraft;
  onChange: (next: ServerDraft) => void;
  errorFor: (field: ConnectErrorField) => string | undefined;
  clear: (field: ConnectErrorField) => void;
}) {
  const { t } = useTranslation();
  const host = `${side}_host` as const;
  const port = `${side}_port` as const;
  const security = `${side}_security` as const;
  const securityId = fieldId(security);
  const securityError = errorFor(security);
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-3 text-label font-medium">{t(`email_hub.connect.custom.${side}_heading`)}</legend>
      {/* Top-aligned: an error under the host must not push the port down. */}
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_6rem]">
        <TextField
          id={fieldId(host)}
          label={t("email_hub.connect.custom.host")}
          error={errorFor(host)}
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t("email_hub.connect.custom.host_placeholder")}
          value={draft.host}
          onChange={(e) => {
            onChange({ ...draft, host: e.target.value });
            clear(host);
          }}
        />
        <TextField
          id={fieldId(port)}
          label={t("email_hub.connect.custom.port")}
          error={errorFor(port)}
          inputMode="numeric"
          value={draft.port}
          onChange={(e) => {
            onChange({ ...draft, port: e.target.value, portEdited: true });
            clear(port);
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <p id={`${securityId}-label`} className="text-label font-medium">
          {t("email_hub.connect.custom.security")}
        </p>
        <RadioGroup
          aria-labelledby={`${securityId}-label`}
          aria-describedby={securityError ? `${securityId}-error` : SECURITY_HINT_ID}
          value={draft.security}
          onValueChange={(value) => {
            const mode = SECURITIES.find((m) => m === value);
            if (!mode) return;
            onChange({ ...draft, security: mode, port: draft.portEdited ? draft.port : String(DEFAULT_PORT[side][mode]) });
          }}
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          {SECURITIES.map((mode) => (
            <Label key={mode} htmlFor={`${securityId}-${mode}`} className="cursor-pointer font-normal">
              <RadioGroupItem value={mode} id={`${securityId}-${mode}`} />
              {t(`email_hub.connect.security_${mode}`)}
            </Label>
          ))}
        </RadioGroup>
        {securityError ? (
          <p id={`${securityId}-error`} className="text-caption text-destructive">
            {securityError}
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}

interface ConnectCustomServerFormProps {
  formId: string;
  /** Reconnect this custom mailbox: the address is fixed and its servers are filled in. The password never is. */
  initial?: EmailHubAccount;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onBack?: () => void;
  onSubmit: (input: { email: string; appPassword: string; server: EmailHubCustomServer }) => void;
}

export function ConnectCustomServerForm({
  formId,
  initial,
  pending,
  error,
  onCancel,
  onBack,
  onSubmit,
}: ConnectCustomServerFormProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initial?.email_address ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [drafts, setDrafts] = useState<Record<Side, ServerDraft>>(() => ({
    imap: initialDraft("imap", initial),
    smtp: initialDraft("smtp", initial),
  }));
  const [invalid, setInvalid] = useState<FieldErrors>({});
  const [usernameOpen, setUsernameOpen] = useState(Boolean(initial?.username));

  const server = error ? connectError(error) : null;
  const errorFor = (field: ConnectErrorField) => {
    const key = invalid[field] ?? (server?.field === field ? server.key : undefined);
    return key ? t(key) : undefined;
  };
  const clear = (field: ConnectErrorField) => setInvalid((prev) => ({ ...prev, [field]: undefined }));
  const formError = server?.field === "form" ? t(server.key) : null;
  // A refused login name must be on screen to be fixed: open it once per error, so it can still be closed.
  const [openedFor, setOpenedFor] = useState<unknown>(null);
  if (server?.field === "username" && openedFor !== error) {
    setOpenedFor(error);
    setUsernameOpen(true);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const found: FieldErrors = {};
    if (!EMAIL_RE.test(address)) found.email = address ? "email_hub.connect.error_email_format" : "email_hub.connect.error_email_required";
    if (!password) found.password = "email_hub.connect.custom.error_password_required";
    for (const side of SIDES) {
      if (!drafts[side].host.trim()) found[`${side}_host` as const] = "email_hub.connect.custom.error_host_required";
      if (!PORT_RE.test(drafts[side].port.trim())) found[`${side}_port` as const] = "email_hub.connect.custom.error_port_format";
    }
    setInvalid(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    const login = username.trim();
    const { imap, smtp } = drafts;
    onSubmit({
      email: address,
      // Sent as typed: unlike Google's grouped app passwords, a mail server password may hold spaces.
      appPassword: password,
      server: {
        imap_host: imap.host.trim(),
        imap_port: Number(imap.port.trim()),
        imap_security: imap.security,
        smtp_host: smtp.host.trim(),
        smtp_port: Number(smtp.port.trim()),
        smtp_security: smtp.security,
        ...(login ? { username: login } : {}),
      },
    });
  };

  return (
    <>
      <FormDialogBody>
        <form id={formId} className="grid gap-4" noValidate onSubmit={submit}>
          <TextField
            id={fieldId("email")}
            label={t("email_hub.connect.email")}
            error={errorFor("email")}
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={t("email_hub.connect.custom.email_placeholder")}
            value={email}
            readOnly={initial !== undefined}
            onChange={(e) => {
              setEmail(e.target.value);
              clear("email");
            }}
          />
          <TextField
            id={fieldId("password")}
            label={t("email_hub.connect.custom.password")}
            error={errorFor("password")}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clear("password");
            }}
          />
          <div className="grid gap-2">
            <button
              type="button"
              className={cn(inlineLinkClass, "justify-self-start text-caption")}
              aria-expanded={usernameOpen}
              aria-controls={usernameOpen ? fieldId("username") : undefined}
              onClick={() => {
                // A hidden login name must not be sent.
                if (usernameOpen) setUsername("");
                setUsernameOpen(!usernameOpen);
              }}
            >
              {t("email_hub.connect.custom.username_toggle")}
            </button>
            {usernameOpen ? (
              <TextField
                id={fieldId("username")}
                label={t("email_hub.connect.custom.username")}
                error={errorFor("username")}
                hint={t("email_hub.connect.custom.username_hint")}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={email.trim() || undefined}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            ) : null}
          </div>
          {SIDES.map((side, i) => (
            <Fragment key={side}>
              {i > 0 ? <Separator /> : null}
              <ServerFieldset
                side={side}
                draft={drafts[side]}
                onChange={(next) => setDrafts((prev) => ({ ...prev, [side]: next }))}
                errorFor={errorFor}
                clear={clear}
              />
            </Fragment>
          ))}
          <p id={SECURITY_HINT_ID} className="text-caption text-pretty text-muted-foreground">
            {t("email_hub.connect.custom.security_hint")}
          </p>
          <ErrorAlert message={formError} focus />
        </form>
        {pending ? (
          <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
            <Spinner />
            {t("email_hub.connect.custom.checking")}
          </p>
        ) : null}
      </FormDialogBody>
      <FormDialogFooter
        leading={
          onBack ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={onBack}>
              {t("email_hub.connect.back")}
            </Button>
          ) : undefined
        }
        onCancel={onCancel}
        submitType="submit"
        form={formId}
        submitLabel={initial ? t("email_hub.reconnect.action") : t("email_hub.connect.submit")}
        submittingLabel={t("email_hub.connect.submitting")}
        submitting={pending}
      />
    </>
  );
}
