"use client";

import { useEffect, useState } from "react";
import { Copy, Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastApiError } from "../../toast-api-error";
import { useAuthStore, useMfaConfirm, useMfaDisable, useMfaSetup, useRefreshSessionUser } from "@uniwork/core/auth";
import type { MFASetup } from "@uniwork/core/api/endpoints/auth";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { DeleteAccountDialog } from "./delete-account-dialog";
import { SessionsSection } from "./security-sessions";
import {
  SettingsBadge,
  SettingsCard,
  SettingsDangerZone,
  SettingsRow,
  SettingsSection,
  SettingsTab,
} from "./settings-layout";

const RECOVERY_FILENAME = "uniwork-recovery-codes.txt";

function downloadRecoveryCodes(codes: string[]) {
  const url = URL.createObjectURL(new Blob([`${codes.join("\n")}\n`], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = RECOVERY_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
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
        <Button className="sm:ml-auto" aria-disabled={refresh.isPending || undefined} onClick={() => refresh.mutate()}>
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
            onEnabled();
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
      <SettingsRow label={t("appLabel")} description={t("disableHint")} size="none">
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
