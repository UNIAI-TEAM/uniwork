"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown, Download, MonitorUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { buildOfficeDeepLink, officeClientId, safeOfficeDeepLink, DESKTOP_INSTALLER_KINDS, DESKTOP_PLATFORMS, type DesktopPlatform, type DesktopPlatformGuess, type OfficeInstallerOption, type OfficeChannel, type OfficeLaunchOutcome, type OfficeState } from "@uniwork/core/office";
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
/** A browser protocol prompt can be answered long after the launch timeout;
 * the app then takes the focus, which closes a not-installed prompt this soon. */
const LATE_HANDOFF_GRACE_MS = 60_000;
const UNKNOWN_PLATFORM: DesktopPlatformGuess = { platform: null, confidence: "unsupported" };

/** How one "open in the desktop app" request ended; the frame `app.open` answer carries it. */
export type DesktopOpenOutcome = "launched" | "installer" | "unavailable";

export interface OfficeSaveOutcome {
  accepted?: boolean;
  version?: number;
  receipt?: { version?: number; versionId?: string };
}

export type OfficeLaunchSessionFactory = (
  documentId: string,
  body: { operation: "edit" | "view"; version?: number; deployment_id: string; client_id: string; return_hint: "office" },
) => Promise<OfficeLaunchSessionResponse | null>;

/** What "Open in desktop app" needs of the editor's save coordinator: save first when there are unsaved edits. */
/** The part of a save state the action reads to decide whether to save first. */
export interface OfficeSaveStateLike {
  state: OfficeState;
  dirtyGeneration: number;
  lastSavedGeneration: number;
}

export interface OfficeSaveCoordinatorLike {
  save(entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry"): Promise<unknown>;
  getState(): OfficeSaveStateLike;
  subscribe?(listener: (state: OfficeSaveStateLike) => void): () => void;
}

export interface DesktopOpenActionProps {
  documentId: string;
  /** Undefined when the server config never advertised a deployment binding;
   * the action then fails closed instead of guessing one. */
  deploymentId: string | undefined;
  /** The deployment's public API origin. With `deploymentId` it rides on the
   * open link so the app connects to (or follows) this server; absent, the
   * link carries no profile and the app keeps the server it has. */
  apiOrigin?: string;
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
  /** Hands the browser the installer URL and resolves with its file name. */
  downloadInstaller?: (platform: DesktopPlatform) => Promise<string>;
  className?: string;
  /** Filled with the same flow the button runs, for a caller that is not the button (a frame's `app.open`). */
  requestRef?: MutableRefObject<(() => Promise<DesktopOpenOutcome>) | null>;
  /** `header` (default) fills the page header slot and its compact menu;
   * `inline` renders in place, always visible, with no header-slot behaviour;
   * `row` is one compact button for a list row (no installer split menu — the
   * install prompt still opens when the app does not answer). */
  placement?: "header" | "inline" | "row";
  /** `view` asks for a read-only session (a viewer, or a file the caller may
   * not change); the server still decides and never upgrades it. */
  operation?: "edit" | "view";
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
  apiOrigin,
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
  requestRef,
  placement = "header",
  operation = "edit",
}: DesktopOpenActionProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.desktop" });
  const [coordinatorState, setCoordinatorState] = useState(() => saveCoordinator?.getState() ?? null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [working, setWorking] = useState(false);
  // An object, so each failed attempt is a new value and the row toast fires again for the same message.
  const [failure, setFailure] = useState<{ message: string } | null>(null);
  const setError = (message: string | null) => setFailure(message === null ? null : { message });
  const error = failure?.message ?? null;
  const [installOpen, setInstallOpen] = useState(false);
  const [installReason, setInstallReason] = useState<"not-installed" | "expired" | "error" | "download">("not-installed");
  const [resolvedInstallers, setResolvedInstallers] = useState(installers);
  const [resolvedPlatforms, setResolvedPlatforms] = useState(supportedPlatforms);
  const [resolvedHint, setResolvedHint] = useState(platformHint);
  const [hintRequested, setHintRequested] = useState(false);
  // A request made while the dirty dialog is the way forward resolves when that dialog's flow ends.
  const pendingRequest = useRef<((outcome: DesktopOpenOutcome) => void) | null>(null);
  const settleRequest = (outcome: DesktopOpenOutcome) => {
    const resolve = pendingRequest.current;
    pendingRequest.current = null;
    resolve?.(outcome);
  };
  const launchedAt = useRef(0);
  const headerSlot = useHeaderActionsSlotAvailable();
  const inline = placement !== "header";
  const inPageHeader = headerSlot && !inline;
  const currentlyDirty = dirty || stateDirty(coordinatorState);
  const canOpenSaved = savedVersion !== null && Number.isSafeInteger(savedVersion) && savedVersion > 0;
  const label = t("action");

  useEffect(() => {
    if (!saveCoordinator?.subscribe) return;
    setCoordinatorState(saveCoordinator.getState());
    return saveCoordinator.subscribe(setCoordinatorState);
  }, [saveCoordinator]);
  // The page cannot tell whether the browser's protocol prompt was accepted, so
  // a focus or visibility change soon after a failed launch means the app did
  // answer: drop the "did not respond" prompt instead of contradicting it.
  useEffect(() => {
    if (!installOpen || installReason !== "not-installed") return;
    const onHandoff = () => { if (Date.now() - launchedAt.current < LATE_HANDOFF_GRACE_MS) setInstallOpen(false); };
    const onVisibility = () => { if (document.visibilityState === "hidden") onHandoff(); };
    window.addEventListener("blur", onHandoff);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onHandoff);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [installOpen, installReason]);
  useEffect(() => {
    if (placement === "row" && failure) toast.error(failure.message);
  }, [placement, failure]);
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

  const startHandoff = async (version: number): Promise<DesktopOpenOutcome> => {
    if (working || !Number.isSafeInteger(version) || version <= 0) return "unavailable";
    if (!deploymentId) { setError(t("ticket_failed")); return "unavailable"; }
    setWorking(true);
    setError(null);
    try {
      // `version` names a HISTORICAL version and makes the server force a
      // read-only session; the committed version being handed off is the
      // current one, so the body leaves it out. The check above only proves
      // the editor knows what it is handing off.
      const session = await createSession(documentId, {
        operation, deployment_id: deploymentId, client_id: clientId, return_hint: "office",
      });
      if (!session) {
        setError(t("ticket_failed"));
        return "unavailable";
      }
      // Rebuild from the ticket even when the server included a URL. This
      // keeps the scheme/channel binding and excludes title/path/token/bytes;
      // only the public deployment profile is added.
      const profile = apiOrigin ? { deploymentId, apiOrigin } : undefined;
      const url = safeOfficeDeepLink(session, channel, profile);
      if (!url || url !== buildOfficeDeepLink(session.launch_ticket, channel, profile)) {
        setError(t("ticket_failed"));
        return "unavailable";
      }
      launchedAt.current = Date.now();
      const outcome = launch ? await launch(url) : "not-installed";
      if (outcome === "launched") return "launched";
      await openInstallPrompt(outcome === "expired" ? "expired" : outcome === "error" ? "error" : "not-installed");
      return "installer";
    } catch {
      setError(t("ticket_failed"));
      return "unavailable";
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
      settleRequest(await startHandoff(version));
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
  const request = () => new Promise<DesktopOpenOutcome>((resolve) => {
    if (working || pendingRequest.current) { resolve("unavailable"); return; }
    setError(null);
    if (currentlyDirty) { pendingRequest.current = resolve; setChoiceOpen(true); }
    else if (canOpenSaved) void startHandoff(savedVersion).then(resolve);
    else { setError(t("version_unavailable")); resolve("unavailable"); }
  });
  const requestLatest = useRef(request);
  requestLatest.current = request;
  useEffect(() => {
    if (!requestRef) return undefined;
    requestRef.current = () => requestLatest.current();
    return () => { requestRef.current = null; };
  }, [requestRef]);

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
      {placement === "row" ? (
        // Icon-only, per the design: the Name column keeps the width, the text
        // stays in the accessible name and the title is the tooltip. A failure goes to a toast (see the effect above), so
        // nothing wide lands in the row cell.
        <Button
          type="button"
          variant="outline"
          size="xs"
          className={className}
          data-office-desktop-action
          onClick={() => { if (!working) onAction(); }}
          aria-disabled={working || undefined}
          title={label}
        >
          <MonitorUp aria-hidden />
          <span className="sr-only">{working ? t("working") : t("row_action")}</span>
        </Button>
      ) : (
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
      )}
      {error && placement !== "row" ? <p role="alert" className="max-w-56 text-caption leading-tight text-destructive">{error}</p> : null}
      <Dialog open={choiceOpen} onOpenChange={(open) => { if (working) return; setChoiceOpen(open); if (!open) settleRequest("unavailable"); }}>
        <DialogContent className="sm:max-w-md" aria-describedby="office-desktop-choice-description">
          <DialogHeader>
            <DialogTitle>{t("dirty_title")}</DialogTitle>
            <DialogDescription id="office-desktop-choice-description">{t("dirty_description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-col sm:items-stretch">
            <Button type="button" onClick={() => void saveThenOpen()} disabled={working}>{t("save_then_open")}</Button>
            <Button type="button" variant="outline" onClick={() => { setChoiceOpen(false); if (savedVersion !== null) void startHandoff(savedVersion).then(settleRequest); }} disabled={working || !canOpenSaved}>{t("open_saved")}</Button>
            <Button type="button" variant="ghost" onClick={() => { setChoiceOpen(false); settleRequest("unavailable"); }} disabled={working}>{t("cancel")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OfficeInstallPrompt {...installProps} onDownload={downloadInstaller ?? (async () => { throw new Error("download handler unavailable"); })} />
    </>
  );
}
