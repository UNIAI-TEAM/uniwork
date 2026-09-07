"use client";

import { useEffect, useState } from "react";
import { Loader2, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import QRCode from "qrcode";
import { toastApiError } from "../../toast-api-error";
import {
  useAuthStore,
  useMfaConfirm,
  useMfaDisable,
  useMfaSetup,
  useRefreshSessionUser,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
} from "@uniwork/core/auth";
import type { MFASetup } from "@uniwork/core/api/endpoints/auth";
import type { UserSession } from "@uniwork/core/types";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { SettingsCard, SettingsRow, SettingsSection, SettingsTab } from "./settings-layout";

export function SecurityTab() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security" });
  const { t: tPage } = useTranslation(undefined, { keyPrefix: "settings" });
  const user = useAuthStore((s) => s.user);
  const mfaOn = !!user?.mfa_enabled_at;

  return (
    <SettingsTab title={tPage("page.tabs.security")}>
      {user?.platform_role && !mfaOn ? (
        <Alert className="mb-6">
          <AlertTitle>{t("mfa.platformRequiredTitle")}</AlertTitle>
          <AlertDescription>{t("mfa.platformRequired")}</AlertDescription>
        </Alert>
      ) : null}
      <SettingsSection title={t("mfa.section")} description={t("mfa.description")}>
        <SettingsCard>{mfaOn ? <DisableMfa /> : <EnrolMfa />}</SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("sessions.section")} description={t("sessions.description")} className="mt-8">
        <SettingsCard>
          <SessionsList />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("delete.section")} description={t("delete.description")} className="mt-8">
        <SettingsCard>
          <SettingsRow label={t("delete.label")} description={t("delete.hint")} size="none">
            <div className="flex justify-start sm:justify-end">
              <DeleteAccountDialog />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </SettingsTab>
  );
}

/** Three screens in one card: start → scan and confirm → recovery codes shown once. */
function EnrolMfa() {
  const { t } = useTranslation(undefined, { keyPrefix: "settings.security.mfa" });
  const setup = useMfaSetup();
  const confirm = useMfaConfirm();
  const refresh = useRefreshSessionUser();
  const [pending, setPending] = useState<MFASetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    // A canvas-less environment (tests) simply shows the secret for manual entry.
    QRCode.toDataURL(pending.otpauth_url, { margin: 1, width: 192 })
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [pending]);

  if (codes) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-body font-medium">{t("recoveryTitle")}</p>
        <p className="text-caption text-muted-foreground">{t("recoveryHint")}</p>
        <ul className="grid grid-cols-2 gap-1 rounded-md bg-muted p-3 font-mono text-body" aria-label={t("recoveryTitle")}>
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div>
          <Button variant="outline" aria-disabled={refresh.isPending || undefined} onClick={() => refresh.mutate()}>
            {t("recoveryDone")}
          </Button>
        </div>
      </div>
    );
  }

  if (!pending) {
    return (
      <SettingsRow label={t("statusOff")} description={t("statusOffHint")} size="none">
        <div className="flex justify-start sm:justify-end">
          <Button
            aria-disabled={setup.isPending || undefined}
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
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm.isPending || code.trim().length !== 6) return;
        confirm.mutate(code.trim(), {
          onSuccess: (list) => {
            setCodes(list);
            setPending(null);
            setCode("");
            toast.success(t("toastEnabled"));
          },
          onError: (err) => toastApiError(err, t("invalidCode")),
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
      <label className="flex flex-col gap-1 text-body">
        {t("confirmLabel")}
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          className="sm:w-40"
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" aria-disabled={confirm.isPending || undefined}>
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
  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (disable.isPending || !code.trim()) return;
        disable.mutate(code.trim(), {
          onSuccess: () => {
            setCode("");
            toast.success(t("toastDisabled"));
          },
          onError: (err) => toastApiError(err, t("invalidCode")),
        });
      }}
    >
      <SettingsRow label={t("statusOn")} description={t("disableHint")} size="none">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label={t("disableCodeLabel")}
            placeholder={t("disableCodeLabel")}
            autoComplete="one-time-code"
            className="sm:w-44"
          />
          <Button type="submit" variant="outline" aria-disabled={disable.isPending || undefined}>
            {t("disable")}
          </Button>
        </div>
      </SettingsRow>
    </form>
  );
}

function SessionsList() {
  const { t, i18n } = useTranslation(undefined, { keyPrefix: "settings.security.sessions" });
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(i18n.language) : "");

  if (sessions.isPending) {
    return (
      <p className="flex items-center gap-2 p-4 text-body text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        {t("loading")}
      </p>
    );
  }
  if (sessions.isError) {
    return (
      <div className="flex items-center justify-between gap-3 p-4" role="alert">
        <span className="text-body">{t("error")}</span>
        <Button variant="outline" onClick={() => void sessions.refetch()}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  const rows: UserSession[] = sessions.data;
  const others = rows.filter((s) => !s.current).length;
  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center gap-3 p-4">
            <Monitor aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body">
                {s.user_agent || t("unknownBrowser")}
                {s.current ? <span className="ml-2 rounded-4xl bg-muted px-2 text-caption text-muted-foreground">{t("current")}</span> : null}
              </p>
              <p className="truncate text-caption text-muted-foreground">
                {t("meta", { ip: s.ip || "—", at: fmt(s.last_seen_at) })}
              </p>
            </div>
            {!s.current ? (
              <Button
                variant="ghost"
                size="sm"
                aria-disabled={revoke.isPending || undefined}
                onClick={() => revoke.mutate(s.id, { onError: (err) => toastApiError(err, t("revokeFailed")) })}
              >
                {t("revoke")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {others > 0 ? (
        <div className="border-t border-border p-4">
          <Button
            variant="outline"
            aria-disabled={revokeOthers.isPending || undefined}
            onClick={() =>
              revokeOthers.mutate(undefined, {
                onSuccess: () => toast.success(t("revokedOthers")),
                onError: (err) => toastApiError(err, t("revokeFailed")),
              })
            }
          >
            {t("revokeOthers", { count: others })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
