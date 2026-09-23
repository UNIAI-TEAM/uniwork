"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { apiErrorMessage } from "@uniwork/core/api";
import { useAuthStore, useMfaConfirm, useMfaDisable, useMfaSetup, useRefreshSessionUser } from "@uniwork/core/auth";
import type { MFASetup } from "@uniwork/core/api/endpoints/auth";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Field, FieldLabel } from "@uniwork/ui/components/ui/field";
import { Input } from "@uniwork/ui/components/ui/input";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { SessionsSection } from "./security-sessions";
import {
  SettingsBadge,
  SettingsCard,
  SettingsDangerZone,
  SettingsFieldError,
  SettingsRow,
  SettingsSection,
  SettingsTab,
} from "./settings-layout";

const RECOVERY_FILENAME = "uniwork-recovery-codes.txt";
const TOTP_LENGTH = 6;

/**
 * A code field's refusal: shown under the input, tied to it, and focus goes
 * back to the input so the reader can retype without hunting for it.
 */
function useCodeError() {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  return {
    inputRef,
    error,
    clear: () => setError(null),
    fail: (message: string) => {
      setError(message);
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    inputProps: {
      ref: inputRef,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errorId : undefined,
    },
    message: error ? <SettingsFieldError id={errorId}>{error}</SettingsFieldError> : null,
  };
}

function downloadRecoveryCodes(codes: string[]) {
  const url = URL.createObjectURL(new Blob([`${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = RECOVERY_FILENAME;
  // Attached, and revoked a tick later: Firefox and Safari drop a detached or
  // already-revoked blob download.
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function SecurityTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security" });
  const { t: tPage } = useTranslation(undefined, { keyPrefix: "settings" });
  const user = useAuthStore((s) => s.user);
  const mfaOn = !!user?.mfa_enabled_at;
  // Confirming enrolment turns MFA on server-side before the recovery codes
  // are dismissed and the user refetched; the badge follows the server.
  const [justEnabled, setJustEnabled] = useState(false);
  useEffect(() => {
    if (mfaOn) setJustEnabled(false);
  }, [mfaOn]);
  const on = mfaOn || justEnabled;

  return (
    <SettingsTab title={tPage("page.tabs.security")}>
      {user?.platform_role && !mfaOn ? (
        <Alert>
          <AlertTitle>{t("mfa.platformRequiredTitle")}</AlertTitle>
          <AlertDescription>{t("mfa.platformRequired")}</AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection
        title={t("mfa.section")}
        description={t("mfa.description")}
        action={<SettingsBadge tone={on ? "success" : "muted"}>{on ? t("mfa.statusOn") : t("mfa.statusOff")}</SettingsBadge>}
      >
        <SettingsCard>{mfaOn ? <DisableMfa /> : <EnrolMfa onEnabled={() => setJustEnabled(true)} />}</SettingsCard>
      </SettingsSection>
      <SessionsSection />
      <SettingsDangerZone title={t("delete.section")} description={t("delete.description")}>
        <SettingsRow label={t("delete.label")} description={t("delete.hint")} size="none">
          <div className="flex justify-start sm:justify-end">
            <DeleteAccountDialog />
          </div>
        </SettingsRow>
      </SettingsDangerZone>
    </SettingsTab>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.mfa" });
  const refresh = useRefreshSessionUser();
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-body font-medium">{t("recoveryTitle")}</p>
      <p className="text-caption text-muted-foreground">{t("recoveryHint")}</p>
      <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-body" aria-label={t("recoveryTitle")}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() =>
            void copyText(codes.join("\n")).then((ok) =>
              ok ? toast.success(t("recoveryCopied")) : toast.error(t("recoveryCopyFailed")),
            )
          }
        >
          <Copy aria-hidden />
          {t("recoveryCopy")}
        </Button>
        <Button variant="outline" onClick={() => downloadRecoveryCodes(codes)}>
          <Download aria-hidden />
          {t("recoveryDownload")}
        </Button>
        {/* No field here, so a failure is a toast (with the server's words). */}
        <Button
          className="sm:ml-auto"
          aria-disabled={refresh.isPending || undefined}
          aria-busy={refresh.isPending || undefined}
          onClick={() => {
            if (refresh.isPending) return;
            refresh.mutate(undefined, { onError: (err) => toastApiError(err, t("toastFailed")) });
          }}
        >
          {refresh.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {t("recoveryDone")}
        </Button>
      </div>
    </div>
  );
}

/** Three screens in one card: start → scan and confirm → recovery codes shown once. */
function EnrolMfa({ onEnabled }: { onEnabled: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.mfa" });
  const setup = useMfaSetup();
  const confirm = useMfaConfirm();
  const [pending, setPending] = useState<MFASetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const codeError = useCodeError();
  const codeId = useId();

  useEffect(() => {
    if (!pending) return;
    let live = true;
    // qrcode loads on enrolment only, so the settings route does not carry
    // it; a canvas-less environment (tests) simply shows the secret.
    import("qrcode")
      .then((m) => m.default.toDataURL(pending.otpauth_url, { margin: 1, width: 192 }))
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [pending]);

  if (codes) return <RecoveryCodes codes={codes} />;

  if (!pending) {
    return (
      <SettingsRow label={t("appLabel")} description={t("statusOffHint")} size="none">
        <div className="flex justify-start sm:justify-end">
          <Button
            aria-disabled={setup.isPending || undefined}
            aria-busy={setup.isPending || undefined}
            onClick={() => {
              if (setup.isPending) return;
              setup.mutate(undefined, {
                onSuccess: (out) => {
                  if (out) setPending(out);
                  else toast.error(t("toastFailed"));
                },
                onError: (err) => toastApiError(err, t("toastFailed")),
              });
            }}
          >
            {setup.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {t("enable")}
          </Button>
        </div>
      </SettingsRow>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm.isPending) return;
        const value = code.trim();
        if (!/^\d{6}$/.test(value)) {
          codeError.fail(t("codeLength", { count: TOTP_LENGTH }));
          return;
        }
        codeError.clear();
        confirm.mutate(value, {
          onSuccess: (list) => {
            setCodes(list);
            setPending(null);
            setCode("");
            onEnabled();
            toast.success(t("toastEnabled"));
          },
          onError: (err) => codeError.fail(apiErrorMessage(err) ?? t("invalidCode")),
        });
      }}
    >
      <p className="text-body">{t("scanHint")}</p>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {qr ? <img src={qr} alt={t("qrAlt")} width={192} height={192} className="rounded-md border border-border" /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-muted-foreground">{t("manualSecret")}</span>
          <code className="break-all rounded-md bg-muted px-2 py-1 font-mono text-body">{pending.secret}</code>
        </div>
      </div>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={codeId}>{t("confirmLabel")}</FieldLabel>
        <Input
          {...codeError.inputProps}
          id={codeId}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            codeError.clear();
          }}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={TOTP_LENGTH}
          className="sm:w-40"
        />
        {codeError.message}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" aria-disabled={confirm.isPending || undefined} aria-busy={confirm.isPending || undefined}>
          {confirm.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
          {t("confirm")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPending(null)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function DisableMfa() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.mfa" });
  const disable = useMfaDisable();
  const [code, setCode] = useState("");
  const codeError = useCodeError();
  const inputId = useId();
  const hintId = useId();
  return (
    <form
      className="contents"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (disable.isPending) return;
        if (!code.trim()) {
          codeError.fail(t("disableCodeRequired"));
          return;
        }
        codeError.clear();
        disable.mutate(code.trim(), {
          onSuccess: () => {
            setCode("");
            toast.success(t("toastDisabled"));
          },
          onError: (err) => codeError.fail(apiErrorMessage(err) ?? t("invalidCode")),
        });
      }}
    >
      <SettingsRow
        label={<label htmlFor={inputId}>{t("disableCodeLabel")}</label>}
        description={t("disableHint")}
        descriptionId={hintId}
        size="none"
        align="start"
      >
        <div className="flex flex-col gap-1.5 sm:items-end">
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Recovery codes are letters and digits (abcde-12345), so the
                keyboard stays a text one; only the case and spelling helpers go. */}
            <Input
              {...codeError.inputProps}
              id={inputId}
              aria-describedby={[hintId, codeError.inputProps["aria-describedby"]].filter(Boolean).join(" ")}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                codeError.clear();
              }}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="sm:w-44"
            />
            <Button
              type="submit"
              variant="outline"
              aria-disabled={disable.isPending || undefined}
              aria-busy={disable.isPending || undefined}
            >
              {disable.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              {t("disable")}
            </Button>
          </div>
          {codeError.message}
        </div>
      </SettingsRow>
    </form>
  );
}
