"use client";

import { useState, type ComponentProps, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { EmailHubAccount, EmailHubCustomServer } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { FormDialogBody, FormDialogFooter } from "../common/form-dialog";
import { EMAIL_RE } from "../workspace/email-chips-input";
import { connectError, type ConnectErrorField } from "./connect-account-errors";

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
const FIELD_ORDER: readonly ConnectErrorField[] = ["email", "imap_host", "imap_port", "smtp_host", "smtp_port"];

const fieldId = (field: ConnectErrorField) => `email-hub-custom-${field}`;

function initialDraft(side: Side, account: EmailHubAccount | undefined): ServerDraft {
  const saved = side === "imap" ? account?.imap_security : account?.smtp_security;
  const security = saved === "tls" || saved === "starttls" ? saved : DEFAULT_SECURITY[side];
  const host = (side === "imap" ? account?.imap_host : account?.smtp_host) ?? "";
  const port = (side === "imap" ? account?.imap_port : account?.smtp_port) ?? DEFAULT_PORT[side][security];
  return { host, port: String(port), security, portEdited: false };
}

function TextField({
  field,
  label,
  error,
  hint,
  ...input
}: { field: ConnectErrorField; label: string; error?: string; hint?: string } & ComponentProps<typeof Input>) {
  const id = fieldId(field);
  const noteId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={noteId} {...input} />
      {error ? (
        <p id={noteId} className="text-caption text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-caption text-pretty text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
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
    <fieldset className="grid gap-3 rounded-lg border border-border px-3 pt-1 pb-3">
      <legend className="px-1 text-label font-medium">{t(`email_hub.connect.custom.${side}_heading`)}</legend>
      <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
        <TextField
          field={host}
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
          field={port}
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
          aria-describedby={securityError ? `${securityId}-error` : undefined}
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

  const server = error ? connectError(error) : null;
  const errorFor = (field: ConnectErrorField) => {
    const key = invalid[field] ?? (server?.field === field ? server.key : undefined);
    return key ? t(key) : undefined;
  };
  const clear = (field: ConnectErrorField) => setInvalid((prev) => ({ ...prev, [field]: undefined }));
  const formError = server?.field === "form" ? t(server.key) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    const found: FieldErrors = {};
    if (!EMAIL_RE.test(address)) found.email = "email_hub.connect.error_email_format";
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
            field="email"
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
            field="username"
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
          <TextField
            field="password"
            label={t("email_hub.connect.custom.password")}
            error={errorFor("password")}
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {SIDES.map((side) => (
            <ServerFieldset
              key={side}
              side={side}
              draft={drafts[side]}
              onChange={(next) => setDrafts((prev) => ({ ...prev, [side]: next }))}
              errorFor={errorFor}
              clear={clear}
            />
          ))}
          {formError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-caption text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
        </form>
      </FormDialogBody>
      <FormDialogFooter
        leading={
          onBack ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onBack}>
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
        submitDisabled={!email.trim() || !password}
      />
    </>
  );
}
