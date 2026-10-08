import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { DesktopDeploymentImportStatus, DesktopDeploymentResetStatus } from "../shared/ipc";

/** The renderer's whole say in the deployment connection: ask main to run its
 * own picker or reset. It never names a path or sends file content; main
 * answers a typed status that this module turns into copy. */
export type LoginConnection = Readonly<{
  importProfile?: () => Promise<DesktopDeploymentImportStatus>;
  /** Present only while the profile in use is one the user imported. */
  resetConnection?: () => Promise<DesktopDeploymentResetStatus>;
}>;

const IMPORT_MESSAGE: Partial<Record<DesktopDeploymentImportStatus, string>> = {
  imported: "importRestarting",
  restart_required: "restartRequired",
  invalid: "importInvalid",
  channel_mismatch: "importChannelMismatch",
  already_configured: "importAlreadyConfigured",
  unavailable: "importFailed",
};

/** "Choose configuration file…" on the no-deployment-profile card. */
export function ImportProfileAction({ importProfile }: { importProfile: NonNullable<LoginConnection["importProfile"]> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.login" });
  const [status, setStatus] = useState<DesktopDeploymentImportStatus | "busy" | undefined>(undefined);
  const choose = () => {
    setStatus("busy");
    importProfile().then(setStatus, () => setStatus("unavailable"));
  };
  const messageKey = status && status !== "busy" ? IMPORT_MESSAGE[status] : undefined;
  // A saved change whose restart the leave dialog refused is progress, not an
  // error; the button stays usable and asks main to restart again.
  const progress = status === "imported" || status === "restart_required";
  return (
    <div className="flex w-full flex-col gap-2" data-import-status={status ?? "idle"}>
      <Button className="w-full" onClick={choose} disabled={status === "busy" || status === "imported"}>
        {t("importProfile")}
      </Button>
      <p className="text-caption text-muted-foreground">{t("importProfileHint")}</p>
      {messageKey ? (
        <p className={progress ? "text-caption text-muted-foreground" : "text-caption text-destructive"} role={progress ? "status" : "alert"}>{t(messageKey)}</p>
      ) : null}
    </div>
  );
}

/** "Reset connection" under the sign-in action of an imported profile. */
export function ResetConnectionAction({ resetConnection }: { resetConnection: NonNullable<LoginConnection["resetConnection"]> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.login" });
  const [status, setStatus] = useState<DesktopDeploymentResetStatus | "busy" | undefined>(undefined);
  const reset = () => {
    setStatus("busy");
    resetConnection().then(setStatus, () => setStatus("unavailable"));
  };
  return (
    <div className="flex w-full flex-col gap-1" data-reset-status={status ?? "idle"}>
      <Button variant="ghost" size="sm" className="w-full" onClick={reset} disabled={status === "busy" || status === "reset"}>
        {t("resetConnection")}
      </Button>
      {status === "reset" ? <p className="text-caption text-muted-foreground" role="status">{t("importRestarting")}</p> : null}
      {status === "restart_required" ? <p className="text-caption text-muted-foreground" role="status">{t("restartRequired")}</p> : null}
      {status === "unavailable" || status === "not_imported" ? <p className="text-caption text-destructive" role="alert">{t("resetFailed")}</p> : null}
    </div>
  );
}
