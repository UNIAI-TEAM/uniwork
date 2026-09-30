"use client";

import { useEffect, useMemo, useState } from "react";
import { MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OfficeSaveCoordinatorLike } from "./office-shell";
import { buildOfficeDeepLink, officeClientId, safeOfficeDeepLink, type OfficeChannel, type OfficeLaunchOutcome } from "@uniwork/core/office";
import {
  createOfficeLaunchSession,
  type OfficeLaunchSessionResponse,
} from "@uniwork/core/api/endpoints/office-launch";
import { Button } from "@uniwork/ui/components/ui/button";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { OfficeInstallPrompt, type OfficeInstallerURLs } from "./install-prompt";

export interface OfficeSaveOutcome {
  accepted?: boolean;
  version?: number;
  receipt?: { version?: number };
}

export type OfficeLaunchSessionFactory = (
  documentId: string,
  body: { operation: "edit"; version: number; deployment_id: string; client_id: string; return_hint: "office" },
) => Promise<OfficeLaunchSessionResponse | null>;

export interface DesktopOpenActionProps {
  documentId: string;
  deploymentId: string;
  /** The selected version must be a server version ordinal, never a file id. */
  savedVersion: number | null;
  dirty?: boolean;
  saveCoordinator?: OfficeSaveCoordinatorLike;
  channel?: OfficeChannel;
  clientId?: string;
  /** Resolve the receipt to its committed version ordinal. Returning null
   * keeps the editor open because a ticket must never target an unproven one. */
  versionAfterSave?: (outcome: OfficeSaveOutcome) => number | null;
  createSession?: OfficeLaunchSessionFactory;
  launch?: (url: string) => Promise<OfficeLaunchOutcome>;
  installerURLs?: OfficeInstallerURLs;
  loadInstallerURLs?: () => Promise<OfficeInstallerURLs>;
  className?: string;
}

function isAccepted(outcome: unknown): outcome is OfficeSaveOutcome & { accepted: true } {
  return Boolean(outcome && typeof outcome === "object" && (outcome as OfficeSaveOutcome).accepted === true);
}

function outcomeVersion(outcome: OfficeSaveOutcome): number | null {
  const version = outcome.version ?? outcome.receipt?.version;
  return typeof version === "number" && Number.isSafeInteger(version) && version > 0 ? version : null;
}

function stateDirty(state: ReturnType<OfficeSaveCoordinatorLike["getState"]> | null): boolean {
  if (!state) return false;
  return state.dirtyGeneration > state.lastSavedGeneration || ["dirty", "saving", "error", "blocked", "conflict"].includes(state.state);
}

/** Header action that explicitly chooses the committed version to hand off.
 * The dirty dialog deliberately has no default action: cancel is safe, Save
 * waits for the coordinator receipt, and Open saved never includes draft data.
 */
export function DesktopOpenAction({
  documentId,
  deploymentId,
  savedVersion,
  dirty = false,
  saveCoordinator,
  channel = "stable",
  clientId = officeClientId(channel),
  versionAfterSave,
  createSession = createOfficeLaunchSession,
  launch,
  installerURLs = { dev: "", beta: "", stable: "" },
  loadInstallerURLs,
  className,
}: DesktopOpenActionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop" });
  const [coordinatorState, setCoordinatorState] = useState(() => saveCoordinator?.getState() ?? null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installReason, setInstallReason] = useState<"not-installed" | "expired" | "error">("not-installed");
  const [resolvedInstallers, setResolvedInstallers] = useState<OfficeInstallerURLs>(installerURLs);
  const currentlyDirty = dirty || stateDirty(coordinatorState);
  const canOpenSaved = savedVersion !== null && Number.isSafeInteger(savedVersion) && savedVersion > 0;
  const label = t("action");

  useEffect(() => {
    if (!saveCoordinator?.subscribe) return;
    setCoordinatorState(saveCoordinator.getState());
    return saveCoordinator.subscribe(setCoordinatorState);
  }, [saveCoordinator]);
  useEffect(() => setResolvedInstallers(installerURLs), [installerURLs.dev, installerURLs.beta, installerURLs.stable]);

  const openInstallPrompt = async (reason: "not-installed" | "expired" | "error") => {
    setInstallReason(reason);
    if (loadInstallerURLs) {
      try { setResolvedInstallers(await loadInstallerURLs()); } catch { setResolvedInstallers({ dev: "", beta: "", stable: "" }); }
    }
    setInstallOpen(true);
  };

  const startHandoff = async (version: number) => {
    if (working || !Number.isSafeInteger(version) || version <= 0) return;
    setWorking(true);
    setError(null);
    try {
      const session = await createSession(documentId, {
        operation: "edit", version, deployment_id: deploymentId, client_id: clientId, return_hint: "office",
      });
      if (!session) {
        setError(t("ticket_failed"));
        return;
      }
      // Rebuild from the ticket even when the server included a URL. This
      // keeps the scheme/channel binding and excludes title/path/token/bytes.
      const url = safeOfficeDeepLink(session, channel);
      if (!url || url !== buildOfficeDeepLink(session.launch_ticket, channel)) {
        setError(t("ticket_failed"));
        return;
      }
      const outcome = launch ? await launch(url) : "not-installed";
      if (outcome !== "launched") await openInstallPrompt(outcome === "expired" ? "expired" : outcome === "error" ? "error" : "not-installed");
    } catch {
      setError(t("ticket_failed"));
    } finally {
      setWorking(false);
    }
  };

  const saveThenOpen = async () => {
    if (!saveCoordinator) { setError(t("save_failed")); return; }
    setWorking(true);
    setError(null);
    try {
      const raw = await saveCoordinator.save("dialog");
      if (!isAccepted(raw)) { setError(t("save_failed")); return; }
      const state = saveCoordinator.getState();
      if (stateDirty(state)) { setError(t("newer_changes")); return; }
      const version = versionAfterSave?.(raw) ?? outcomeVersion(raw);
      if (version === null) { setError(t("save_unverified")); return; }
      setChoiceOpen(false);
      await startHandoff(version);
    } catch {
      setError(t("save_failed"));
    } finally {
      setWorking(false);
    }
  };

  const onAction = () => {
    setError(null);
    if (currentlyDirty) setChoiceOpen(true);
    else if (canOpenSaved) void startHandoff(savedVersion);
    else setError(t("version_unavailable"));
  };

  const installProps = useMemo(() => ({ open: installOpen, channel, installers: resolvedInstallers, onOpenChange: setInstallOpen, onOpenAgain: () => { setInstallOpen(false); if (canOpenSaved) void startHandoff(savedVersion); }, reason: installReason }), [canOpenSaved, channel, installOpen, installReason, resolvedInstallers, savedVersion]);

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={onAction} aria-disabled={working || undefined} aria-label={label}>
        <MonitorUp aria-hidden />
        {working ? t("working") : label}
      </Button>
      {error ? <Alert variant="destructive" role="alert" className="mt-2"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Dialog open={choiceOpen} onOpenChange={(open) => { if (!working) setChoiceOpen(open); }}>
        <DialogContent className="sm:max-w-md" aria-describedby="office-desktop-choice-description">
          <DialogHeader>
            <DialogTitle>{t("dirty_title")}</DialogTitle>
            <DialogDescription id="office-desktop-choice-description">{t("dirty_description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-col sm:items-stretch">
            <Button type="button" onClick={() => void saveThenOpen()} disabled={working}>{t("save_then_open")}</Button>
            <Button type="button" variant="outline" onClick={() => { setChoiceOpen(false); if (savedVersion !== null) void startHandoff(savedVersion); }} disabled={working || !canOpenSaved}>{t("open_saved")}</Button>
            <Button type="button" variant="ghost" onClick={() => setChoiceOpen(false)} disabled={working}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OfficeInstallPrompt {...installProps} />
    </>
  );
}
