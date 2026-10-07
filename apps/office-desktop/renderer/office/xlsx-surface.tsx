import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { XlsxEditor, type XlsxModelHost } from "@uniwork/views/office/xlsx";
import { DraftRecoveryPrompt } from "@uniwork/views/office/leave-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { DropdownMenuGroup } from "@uniwork/ui/components/ui/dropdown-menu";
import { HeaderActionsSlotProvider } from "@uniwork/views/layout/header-actions-slot";
import { RecoveryNotice, type DesktopRecoveryState } from "../recovery-status";
import { LockedAiEntry } from "../ai-entry";
import { FeatureOffNotice } from "./feature-off-notice";
import { useFeatureOffFormatName } from "./feature-off-shell";
import type { ReadOnlyReason } from "../tabs/use-document-tabs";
import type { DesktopDraftMetadata } from "../../shared/ipc";
import type { RendererBridge } from "../app";
import type { DesktopXlsxSession } from "./xlsx-session";
import { DesktopDocumentMenu, useDesktopPrint } from "./document-menu";

/** The desktop XLSX document surface. It mounts the SAME shared XlsxEditor the
 *  web host uses, through the host-adapter seams the session binds: open/save
 *  ride the server job + the ONE office-save command, drafts ride the desktop
 *  draft IPC. No byte write API exists here; Save is the coordinator only. */
export function OpenXlsxDocument({ bridge, session, title, onBack, active = true, kind = "cloud", signedIn = false, onSignIn, readOnlyReason }: {
  bridge: RendererBridge;
  session: DesktopXlsxSession;
  title: string;
  onBack: () => void;
  active?: boolean;
  kind?: "local" | "cloud";
  signedIn?: boolean;
  onSignIn?: () => void;
  /** The tab is view-only because the format's Office flag is off, not because of the reader's permission. */
  readOnlyReason?: ReadOnlyReason;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const { t: tLocal } = useTranslation(undefined, { keyPrefix: "officeDesktop.local" });
  const { t: tAi } = useTranslation(undefined, { keyPrefix: "officeDesktop.ai" });
  const [offer, setOffer] = useState<{ metadata: DesktopDraftMetadata; conflict: boolean } | null>(null);
  const [notice, setNotice] = useState<DesktopRecoveryState | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [host, setHost] = useState<XlsxModelHost | null>(session.rendererHostRef.current);
  const prepareRef = useRef<(() => Promise<void>) | null>(null);
  const featureOff = readOnlyReason !== undefined && !session.canSave;
  const formatName = useFeatureOffFormatName("xlsx");
  const print = useDesktopPrint(bridge);
  const saveState = useSyncExternalStore(session.coordinator.subscribe, () => session.coordinator.getState().state);

  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    const ref = session.rendererHostRef;
    ref.listeners.add(setHost);
    setHost(ref.current);
    return () => { ref.listeners.delete(setHost); };
  }, [session]);
  useEffect(() => {
    let alive = true;
    void session.listDrafts().then((view) => { if (alive && view) setOffer({ metadata: view.metadata, conflict: view.conflict }); });
    return () => { alive = false; };
  }, [session]);
  useEffect(() => bridge.onOfficeSaveRequested?.((event) => { if (active && session.canSave && event.documentId === session.documentKey) void saveCoordinator.save("menu"); })
    // saveCoordinator is stable per session; re-subscribing on every render is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    , [active, bridge, session]);

  // Save must first flush the grid's pending edit so the snapshot it serializes
  // is the one on screen. The shared editor hands us that prepare hook; the
  // wrapped coordinator calls it before the ONE save pipeline.
  const saveCoordinator = useMemo(() => ({
    ...session.coordinator,
    save: async (entryPoint?: "button" | "menu" | "shortcut" | "dialog" | "retry") => {
      try { await prepareRef.current?.(); } catch { return { accepted: false as const, reason: "error" as const }; }
      return session.coordinator.save(entryPoint);
    },
  }), [session]);

  return <>
    {offer ? <DraftRecoveryPrompt open={active} metadata={offer.metadata} conflict={offer.conflict} recoverable={!offer.conflict}
      onOpenChange={(open) => { if (!open) setOffer(null); }}
      onRecover={async () => { const outcome = await session.recoverDraft(offer.metadata); if (outcome === "locked") { setNotice("locked"); setOffer(null); return true; } const applied = outcome === "recovered"; setRecovered(applied); if (applied) setOffer(null); return applied; }}
      onKeep={async () => { setOffer(null); return true; }}
      onDiscard={async () => { if (!await session.discardDraft(offer.metadata)) return false; setOffer(null); return true; }} /> : null}
    {/* The slot provider lets the workbook view contribute its document menu
        items (Print) to the desktop menu, as it does to the web page menu. */}
    <HeaderActionsSlotProvider>
    <OfficeShell title={title} breadcrumbs={[{ label: t(kind === "local" ? "local" : "title") }]} saveCoordinator={saveCoordinator} saveStatus={featureOff ? "ready" : undefined} editorReady={active && session.canSave}
      saveDestination={kind === "local" ? "local" : "cloud"}
      actions={<><DesktopDocumentMenu>
        {kind === "local" ? <DropdownMenuGroup aria-label={tAi("entry")} className="p-1 [&>button]:w-full [&>button]:justify-start"><LockedAiEntry signedIn={signedIn} onSignIn={onSignIn} /></DropdownMenuGroup> : null}
      </DesktopDocumentMenu><Button type="button" variant="outline" disabled={saveState === "saving"} onClick={onBack}>{kind === "local" ? tLocal("home") : t("back")}</Button></>}
      editor={<>
        {recovered ? <p role="status" className="mb-3 text-caption text-muted-foreground">{t("draftRecovered")}</p> : null}
        {notice ? <RecoveryNotice state={notice} className="mb-3" /> : null}
        {featureOff ? <FeatureOffNotice formatName={formatName} reason={readOnlyReason} className="mx-4 my-2" /> : null}
        {print.hint}
        <XlsxEditor
          documentKey={session.documentKey}
          editor={session.editor}
          open={session.open}
          coordinator={session.coordinator}
          {...(host ? { rendererHost: host } : {})}
          capability={session.capability}
          permissions={{ canEdit: session.canSave }}
          title={title}
          embedded
          saveDestination={kind === "local" ? "local" : "cloud"}
          printPort={print.port}
          registerSavePreparation={(prepare) => { prepareRef.current = prepare; return () => { if (prepareRef.current === prepare) prepareRef.current = null; }; }}
        />
      </>} />
    </HeaderActionsSlotProvider>
  </>;
}
