import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DraftRecoveryPrompt, LeaveDialog, type LeaveChoice } from "@uniwork/views/office/leave-dialog";
import { desktopFileResponseSchema, desktopLibraryContextResponseSchema, desktopOfficeOpenResponseSchema, desktopTabsUpdateResponseSchema, type DesktopLibraryContextResponse, type DesktopLibraryDocument, type DesktopSessionMetadata } from "../shared/ipc";
import type { RendererBridge } from "./app";
import { LibraryHost } from "./library/host";
import { LibraryPicker, type LibraryPickerSelection } from "./library/picker";
import { OpenByteDocument } from "./office/open-document";
import { DOCUMENT_TAB_LIMIT } from "./tabs/tab-model";
import { isDocumentDirty, useDocumentTabs } from "./tabs/use-document-tabs";
import { RecoveryNotice } from "./recovery-status";
import { SignedInShell } from "./signed-in-shell";
import { useAccountDrafts } from "./use-account-drafts";

const SESSION_GENERATION = "desktop-dev-session";
export type SignedInMetadata = DesktopSessionMetadata & { status: "signed-in"; accountId: string; deploymentId: string };
type HostLeave = { requestId: string; reason: "close" | "logout" | "update" };
type PendingLeave = { ids: readonly string[]; host?: HostLeave; switchWorkspace?: boolean };

/** One account owns the tab set; each document owns its editor and save session. */
export function SignedInApp({ bridge, metadata, onLogout }: { bridge: RendererBridge; metadata: SignedInMetadata; onLogout: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const tabs = useDocumentTabs(bridge);
  const currentTabs = tabs.current;
  const accountDrafts = useAccountDrafts(bridge);
  const [scope, setScope] = useState<LibraryPickerSelection | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [context, setContext] = useState<DesktopLibraryContextResponse | null>(null);
  const [contextError, setContextError] = useState(false);
  const [contextReload, setContextReload] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actionBusy = useRef(false);
  const [leave, setLeave] = useState<PendingLeave | null>(null);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const answered = useRef(new Set<string>());
  const lifetime = useRef(0);
  const mounted = useRef(true);
  const [pendingLaunch, setPendingLaunch] = useState<{ documentId: string; operation: "view" | "edit"; version?: number } | null>(null);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => () => { mounted.current = false; ++lifetime.current; }, []);
  useEffect(() => {
    let active = true;
    setContextError(false);
    void bridge.call("desktop:library-context", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      if (!active) return;
      const parsed = desktopLibraryContextResponseSchema.safeParse(raw);
      if (!parsed.success) { setContextError(true); return; }
      setContext(parsed.data);
      const next = parsed.data;
      if ([next.deployments, next.accounts, next.organizations, next.workspaces].every((entries) => entries.length === 1)) {
        setScope({ deploymentId: next.deployments[0]!.id, accountId: next.accounts[0]!.id, organizationId: next.organizations[0]!.id, workspaceId: next.workspaces[0]!.id });
      }
    }).catch(() => { if (active) setContextError(true); });
    return () => { active = false; };
  }, [bridge, contextReload]);

  // Serialize native tab registration so an old acknowledgement cannot replace
  // the active tab after a rapid switch. Main validates every document id.
  const syncQueue = useRef(Promise.resolve());
  useEffect(() => {
    syncQueue.current = syncQueue.current.catch(() => undefined).then(async () => {
      if (!mounted.current) return;
      try {
        const live = currentTabs.current;
        const result = desktopTabsUpdateResponseSchema.parse(await bridge.call("desktop:tabs-update", { sessionGeneration: SESSION_GENERATION, documentIds: live.tabs.map((tab) => tab.id), activeDocumentId: live.activeTabId }));
        if (!result.updated) throw new Error("tab_registration_refused");
        if (mounted.current) setSyncError(false);
      } catch { if (mounted.current) setSyncError(true); }
    });
  }, [bridge, tabs.tabs, tabs.activeTabId, currentTabs]);

  const canOpen = (documentId?: string) => {
    if (documentId && tabs.current.current.tabs.some((tab) => tab.id === documentId)) { tabs.select(documentId); return false; }
    if (tabs.current.current.tabs.length < DOCUMENT_TAB_LIMIT) return true;
    setActionError(t("officeDesktop.tabs.limit"));
    return false;
  };
  const acceptCloud = (raw: unknown, selected: LibraryPickerSelection, allowSave = true) => {
    const current = scopeRef.current;
    if (!current || current.workspaceId !== selected.workspaceId || current.accountId !== selected.accountId || current.deploymentId !== selected.deploymentId) return;
    const result = desktopOfficeOpenResponseSchema.parse(raw);
    if (result.document.workspaceId !== selected.workspaceId) throw new Error("workspace_mismatch");
    if (tabs.open({ title: result.document.title, format: result.document.format, bytes: { ...result, canSave: allowSave && result.document.canEdit }, identity: { ...selected, documentId: result.document.id, generation: lifetime.current + 1, baseRevision: result.document.revision, baseVersionId: String(result.document.version) } }) === "limit") setActionError(t("officeDesktop.tabs.limit"));
  };
  const acceptLocal = (raw: unknown) => {
    const result = desktopFileResponseSchema.parse(raw);
    if (!result.opened) return;
    if (!result.metadata || !result.dataBase64) throw new Error("invalid_file");
    if (!/\.docx$/i.test(result.metadata.name)) { setActionError(t("officeDesktop.library.unsupported")); return; }
    const file = result.metadata;
    if (tabs.open({ title: file.name, format: "docx", bytes: { dataBase64: result.dataBase64, checksum: file.checksum, localHandle: file.handle }, identity: { deploymentId: metadata.deploymentId, accountId: metadata.accountId, organizationId: "local", workspaceId: "local", documentId: file.handle, generation: lifetime.current + 1, baseRevision: String(Math.trunc(file.modifiedAtMs)), baseVersionId: file.checksum } }) === "limit") setActionError(t("officeDesktop.tabs.limit"));
  };
  const perform = async (operation: () => Promise<unknown>, accept: (raw: unknown) => void) => {
    if (actionBusy.current || leaveRef.current) return;
    const epoch = lifetime.current;
    actionBusy.current = true; setBusy(true); setActionError(null);
    try {
      const opened = syncQueue.current.catch(() => undefined).then(async () => {
        if (!mounted.current || epoch !== lifetime.current) return;
        const raw = await operation();
        if (mounted.current && epoch === lifetime.current) accept(raw);
      });
      syncQueue.current = opened.catch(() => undefined);
      await opened;
    } catch { if (mounted.current && epoch === lifetime.current) setActionError(t("officeDesktop.library.actionError")); }
    finally { actionBusy.current = false; if (mounted.current) setBusy(false); }
  };
  const openCloud = (document: Pick<DesktopLibraryDocument, "id" | "version">, allowSave = true) => {
    const selected = scopeRef.current;
    if (!selected || !canOpen(document.id)) return;
    void perform(() => bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: selected.workspaceId, documentId: document.id, version: document.version }), (raw) => acceptCloud(raw, selected, allowSave));
  };
  const create = () => {
    const selected = scopeRef.current;
    if (!selected || !canOpen()) return;
    void perform(() => bridge.call("desktop:library-create", { sessionGeneration: SESSION_GENERATION, workspaceId: selected.workspaceId, title: t("officeDesktop.library.untitled") }), (raw) => acceptCloud(raw, selected));
  };
  const openLocal = () => { if (canOpen()) void perform(() => bridge.call("desktop:file-pick-open", { sessionGeneration: SESSION_GENERATION }), acceptLocal); };

  const sendHostAnswer = async (request: HostLeave, choice: LeaveChoice, proceeded: boolean) => {
    if (answered.current.has(request.requestId)) return;
    answered.current.add(request.requestId);
    try { await bridge.call("desktop:leave-resolved", { sessionGeneration: SESSION_GENERATION, requestId: request.requestId, choice, proceeded }); }
    catch { if (mounted.current) setActionError(t("officeDesktop.library.actionError")); }
  };
  const switchWorkspace = () => { ++lifetime.current; tabs.reset(); setScope(null); setPendingLaunch(null); setPendingFile(null); };
  const requestLeave = (request: PendingLeave) => {
    if (leaveRef.current) return;
    const dirty = tabs.current.current.tabs.some((tab) => request.ids.includes(tab.id) && isDocumentDirty(tab.data.session));
    if (!dirty) {
      if (request.host) void sendHostAnswer(request.host, "discard", true);
      else if (request.switchWorkspace) switchWorkspace();
      else request.ids.forEach(tabs.close);
      return;
    }
    leaveRef.current = request; setLeave(request);
  };
  const close = (id: string) => requestLeave({ ids: [id] });
  const finishLeave = (choice: LeaveChoice) => {
    const request = leaveRef.current;
    leaveRef.current = null; setLeave(null);
    if (!request) return;
    if (request.host) { void sendHostAnswer(request.host, choice, choice !== "stay"); return; }
    if (choice === "stay") return;
    if (request.switchWorkspace) switchWorkspace();
    else request.ids.forEach(tabs.close);
  };
  const runLeaveAction = async (action: "save" | "keep" | "discard") => {
    const request = leaveRef.current;
    if (!request) return false;
    const affected = tabs.current.current.tabs.filter((tab) => request.ids.includes(tab.id));
    for (const tab of affected) {
      const session = tab.data.session;
      if (action === "save") {
        if (isDocumentDirty(session) && (!(await session.coordinator.save("dialog")).accepted || isDocumentDirty(session))) return false;
      } else if (action === "keep") { if (!await session.keepDraft()) return false; }
      else if (!await session.discardDraft()) return false;
    }
    // Typing may continue while Save N settles: a newer dirty generation stays.
    return action !== "save" || affected.every((tab) => !isDocumentDirty(tab.data.session));
  };

  const handlers = useRef({ requestLeave, close, acceptLocal });
  handlers.current = { requestLeave, close, acceptLocal };
  useEffect(() => {
    const offLeave = bridge.onLeaveRequested?.((host) => handlers.current.requestLeave({ ids: tabs.current.current.tabs.map((tab) => tab.id), host }));
    const offLaunch = bridge.onLaunchRequested?.(setPendingLaunch);
    const offFile = bridge.onFileOpenRequested?.((event) => setPendingFile(event.handle));
    const offSave = bridge.onOfficeSaveRequested?.((event) => {
      const active = tabs.current.current.tabs.find((tab) => tab.id === tabs.current.current.activeTabId);
      if (active?.id === event.documentId && !leaveRef.current && !document.querySelector('[role="dialog"]')) void active.data.session.coordinator.save("menu");
    });
    const shortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || leaveRef.current || document.querySelector('[role="dialog"]')) return;
      const stop = () => { event.preventDefault(); event.stopImmediatePropagation(); };
      if (event.key.toLowerCase() === "s" && !event.isComposing) {
        stop();
        const active = tabs.current.current.tabs.find((tab) => tab.id === tabs.current.current.activeTabId);
        if (active) void active.data.session.coordinator.save("shortcut");
      } else if (event.key === "Tab") { stop(); tabs.cycle(event.shiftKey ? -1 : 1); }
      else if (event.key.toLowerCase() === "w" && tabs.current.current.activeTabId) { stop(); handlers.current.close(tabs.current.current.activeTabId); }
      else if (/^[1-8]$/.test(event.key)) { const id = tabs.current.current.tabs[Number(event.key) - 1]?.id; if (id) { stop(); tabs.select(id); } }
    };
    window.addEventListener("keydown", shortcut, true);
    return () => { offLeave?.(); offLaunch?.(); offFile?.(); offSave?.(); window.removeEventListener("keydown", shortcut, true); };
  // The account lifetime subscriptions use the live tab set and handlers above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  useEffect(() => {
    if (!pendingFile || busy || leave) return;
    const handle = pendingFile; setPendingFile(null);
    if (canOpen(handle)) void perform(() => bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle }), acceptLocal);
  // Native open is queued only while an action/dialog is settling, never behind another tab.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFile, busy, leave]);
  useEffect(() => {
    if (!pendingLaunch || !scope || busy || leave) return;
    const launch = pendingLaunch; setPendingLaunch(null);
    if (!canOpen(launch.documentId)) return;
    const selected = scope;
    void perform(() => bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: selected.workspaceId, documentId: launch.documentId, ...(launch.version === undefined ? {} : { version: launch.version }) }), (raw) => acceptCloud(raw, selected, launch.operation === "edit"));
  // Ticket lifetime is bound to the current account, scope and action queue.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLaunch, scope, busy, leave]);

  const affected = tabs.tabs.filter((tab) => leave?.ids.includes(tab.id));
  const account = context?.accounts.find((entry) => entry.id === metadata.accountId);
  const workspace = context?.workspaces.find((entry) => entry.id === scope?.workspaceId);
  return <SignedInShell onSignOut={() => { void Promise.resolve().then(onLogout).catch(() => setActionError(t("officeDesktop.library.actionError"))); }} accountName={account?.name} accountEmail={account?.email} workspaceName={workspace?.name}
    tabs={tabs.summaries} activeTabId={tabs.activeTabId} onTabSelect={tabs.select} onTabClose={close} onCreate={create} onOpenLocal={openLocal}
    createDisabled={!scope} busy={busy || leave !== null} onSwitchWorkspace={() => requestLeave({ ids: tabs.tabs.map((tab) => tab.id), switchWorkspace: true })}>
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault(); const file = event.dataTransfer.files[0];
      if (file && bridge.openDroppedFile && canOpen()) void perform(() => bridge.openDroppedFile!(file), acceptLocal);
    }}>
      {actionError ? <p role="alert" className="p-4 text-body text-destructive">{actionError}</p> : null}
      {syncError ? <p role="alert" className="px-4 py-2 text-body text-destructive">{t("officeDesktop.tabs.sessionError")}</p> : null}
      {tabs.checkpointFailures.length > 0 ? <p role="alert" className="px-4 py-2 text-body text-destructive">{t("officeDesktop.tabs.checkpointFailed")}</p> : null}
      <div role="tabpanel" id="desktop-panel-library" aria-labelledby="desktop-tab-library" hidden={tabs.activeTabId !== null} inert={tabs.activeTabId !== null} className="min-h-0 flex-1 flex-col data-[active=true]:flex" data-active={tabs.activeTabId === null}>
        {scope ? <LibraryHost bridge={bridge} scope={{ ...metadata, ...scope }} onCreate={create} onOpenLocal={openLocal} onOpen={openCloud} /> : <LibraryPicker context={context} error={contextError} onRetry={() => setContextReload((value) => value + 1)} onChoose={setScope} />}
      </div>
      {tabs.tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`desktop-panel-${tab.id}`} aria-labelledby={`desktop-tab-${tab.id}`} hidden={tabs.activeTabId !== tab.id} inert={tabs.activeTabId !== tab.id} className="min-h-0 flex-1 flex-col data-[active=true]:flex" data-active={tabs.activeTabId === tab.id}>
        <OpenByteDocument bridge={bridge} identity={tab.data.identity} session={tab.data.session} title={tab.title} active={tabs.activeTabId === tab.id} onBack={() => tabs.select(null)} />
      </div>)}
    </div>
    {accountDrafts.blocked ? <RecoveryNotice state={accountDrafts.blocked} className="p-4" /> : null}
    {accountDrafts.draft && tabs.tabs.length === 0 ? <DraftRecoveryPrompt open metadata={accountDrafts.draft} recoverable={false} onOpenChange={(open) => { if (!open) accountDrafts.dismiss(); }} onRecover={async () => false} onKeep={async () => { accountDrafts.dismiss(); return true; }} onDiscard={accountDrafts.discard} /> : null}
    <LeaveDialog open={leave !== null} dirty={affected.some((tab) => isDocumentDirty(tab.data.session))} saving={affected.some((tab) => tab.data.session.coordinator.getState().state === "saving")}
      onOpenChange={(open) => { if (!open && leaveRef.current) finishLeave("stay"); }} onSave={() => runLeaveAction("save")} onKeepDraft={() => runLeaveAction("keep")} onDiscard={() => runLeaveAction("discard")} onChoice={finishLeave} />
  </SignedInShell>;
}
