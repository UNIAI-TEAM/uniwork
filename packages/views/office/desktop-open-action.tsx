"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OfficeSaveCoordinatorLike } from "./office-shell";
import { buildOfficeDeepLink, officeClientId, safeOfficeDeepLink, DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, type DesktopPlatform, type DesktopPlatformGuess, type OfficeInstallerOption, type OfficeChannel, type OfficeLaunchOutcome } from "@uniwork/core/office";
import {
  createOfficeLaunchSession,
  type OfficeLaunchSessionResponse,
} from "@uniwork/core/api/endpoints/office-launch";
import { Button } from "@uniwork/ui/components/ui/button";
import { ButtonGroup } from "@uniwork/ui/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { HeaderActionsFill, useHeaderActionsSlotAvailable } from "../layout/header-actions-slot";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { OfficeInstallPrompt } from "./install-prompt";

const EMPTY_INSTALLERS: OfficeInstallerOption[] = [];
const UNKNOWN_PLATFORM: DesktopPlatformGuess = { platform: null, confidence: "unsupported" };

export interface OfficeSaveOutcome {
  accepted?: boolean;
  version?: number;
  receipt?: { version?: number; versionId?: string };
}

export type OfficeLaunchSessionFactory = (
  documentId: string,
  body: { operation: "edit"; version: number; deployment_id: string; client_id: string; return_hint: "office" },
) => Promise<OfficeLaunchSessionResponse | null>;

export interface DesktopOpenActionProps {
  documentId: string;
  /** Undefined when the server config never advertised a deployment binding;
   * the action then fails closed instead of guessing one. */
  deploymentId: string | undefined;
  /** The selected version must be a server version ordinal, never a file id. */
  savedVersion: number | null;
  dirty?: boolean;
  saveCoordinator?: OfficeSaveCoordinatorLike;
  channel?: OfficeChannel;
  clientId?: string;
  /** Resolve the receipt to its committed version ordinal. Returning null
   * keeps the editor open because a ticket must never target an unproven one. */
  versionAfterSave?: (outcome: OfficeSaveOutcome) => number | null | Promise<number | null>;
  createSession?: OfficeLaunchSessionFactory;
  launch?: (url: string) => Promise<OfficeLaunchOutcome>;
  installers?: OfficeInstallerOption[];
  supportedPlatforms?: readonly DesktopPlatform[];
  platformHint?: DesktopPlatformGuess;
  loadInstallers?: () => Promise<{ installers: OfficeInstallerOption[]; supportedPlatforms?: readonly DesktopPlatform[] }>;
  loadPlatformHint?: () => Promise<DesktopPlatformGuess>;
  downloadInstaller?: (platform: DesktopPlatform) => Promise<void>;
  className?: string;
  /** `header` (default) fills the page header slot and its compact menu;
   * `inline` renders in place, always visible, with no header-slot behaviour. */
  placement?: "header" | "inline";
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
  installers = EMPTY_INSTALLERS,
  supportedPlatforms = DESKTOP_PLATFORMS,
  platformHint = UNKNOWN_PLATFORM,
  loadInstallers,
  loadPlatformHint,
  downloadInstaller,
  className,
  placement = "header",
}: DesktopOpenActionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop" });
  const [coordinatorState, setCoordinatorState] = useState(() => saveCoordinator?.getState() ?? null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [installReason, setInstallReason] = useState<"not-installed" | "expired" | "error" | "download">("not-installed");
  const [resolvedInstallers, setResolvedInstallers] = useState(installers);
  const [resolvedPlatforms, setResolvedPlatforms] = useState(supportedPlatforms);
  const [resolvedHint, setResolvedHint] = useState(platformHint);
  const [hintRequested, setHintRequested] = useState(false);
  const headerSlot = useHeaderActionsSlotAvailable();
  const inline = placement === "inline";
  const inPageHeader = headerSlot && !inline;
  const currentlyDirty = dirty || stateDirty(coordinatorState);
  const canOpenSaved = savedVersion !== null && Number.isSafeInteger(savedVersion) && savedVersion > 0;
  const label = t("action");

  useEffect(() => {
    if (!saveCoordinator?.subscribe) return;
    setCoordinatorState(saveCoordinator.getState());
    return saveCoordinator.subscribe(setCoordinatorState);
  }, [saveCoordinator]);
  useEffect(() => setResolvedInstallers(installers), [installers]);
  useEffect(() => setResolvedPlatforms(supportedPlatforms), [supportedPlatforms]);
  useEffect(() => setResolvedHint(platformHint), [platformHint]);

  const openInstallPrompt = async (reason: "not-installed" | "expired" | "error" | "download") => {
    setInstallReason(reason);
    await Promise.all([
      loadInstallers ? loadInstallers().then((profile) => { setResolvedInstallers(profile.installers); setResolvedPlatforms(profile.supportedPlatforms ?? DESKTOP_PLATFORMS); }).catch(() => { setResolvedInstallers([]); }) : Promise.resolve(),
      loadPlatformHint ? loadPlatformHint().then(setResolvedHint).catch(() => { setResolvedHint(UNKNOWN_PLATFORM); }) : Promise.resolve(),
    ]);
    setInstallOpen(true);
  };

  const startHandoff = async (version: number) => {
    if (working || !Number.isSafeInteger(version) || version <= 0) return;
    if (!deploymentId) { setError(t("ticket_failed")); return; }
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
      const version = await (versionAfterSave?.(raw) ?? outcomeVersion(raw));
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

  const installProps = { open: installOpen, channel, installers: resolvedInstallers, supportedPlatforms: resolvedPlatforms, platformHint: resolvedHint, onOpenChange: setInstallOpen, onOpenAgain: () => { setInstallOpen(false); if (canOpenSaved) void startHandoff(savedVersion); }, reason: installReason };

  // The menu names the detected platform once it is known; the install prompt
  // it opens preselects that platform and still lists every other one.
  const requestHint = (open: boolean) => {
    if (!open || hintRequested || !loadPlatformHint) return;
    setHintRequested(true);
    void loadPlatformHint().then(setResolvedHint).catch(() => setResolvedHint(UNKNOWN_PLATFORM));
  };
  const detectedPlatform = resolvedHint.platform && resolvedPlatforms.includes(resolvedHint.platform) ? resolvedHint.platform : null;
  const downloadLabel = detectedPlatform
    ? t("download_for", { os: t(`install.os.${DESKTOP_INSTALLER_KINDS[detectedPlatform].os}`) })
    : t("download");
  const openDownload = () => { void openInstallPrompt("download"); };
  // Under the page header on a phone the split button folds into the page's
  // overflow menu; these items carry the same two intents there.
  const compactMenuItems = inPageHeader ? (
    <>
      <DropdownMenuItem className="gap-2 px-2 py-2 sm:hidden" onClick={onAction}>
        <MonitorUp aria-hidden className="size-3.5" />
        {label}
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2 px-2 py-2 sm:hidden" onClick={openDownload}>
        <Download aria-hidden className="size-3.5" />
        {downloadLabel}
      </DropdownMenuItem>
    </>
  ) : null;

  return (
    <>
      {compactMenuItems ? <HeaderActionsFill menuItems={compactMenuItems} /> : null}
      <ButtonGroup className={cn(inPageHeader && "hidden sm:flex", className)} data-office-desktop-action>
        <Button type="button" variant={inline ? "default" : "outline"} size="sm" onClick={onAction} aria-disabled={working || undefined} aria-label={label} title={label}>
          <MonitorUp aria-hidden />
          <span className={inline ? undefined : "sr-only lg:not-sr-only"}>{working ? t("working") : label}</span>
        </Button>
        <DropdownMenu onOpenChange={requestHint}>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={t("menu")} title={t("menu")} />}>
            <ChevronDown aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuItem className="gap-2 px-2 py-2" onClick={onAction}>
              <MonitorUp aria-hidden className="size-3.5" />
              {label}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 px-2 py-2" onClick={openDownload}>
              <Download aria-hidden className="size-3.5" />
              {downloadLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
      {error ? <p role="alert" className="max-w-56 text-caption leading-tight text-destructive">{error}</p> : null}
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
      <OfficeInstallPrompt {...installProps} onDownload={downloadInstaller ?? (async () => { throw new Error("download handler unavailable"); })} />
    </>
  );
}
