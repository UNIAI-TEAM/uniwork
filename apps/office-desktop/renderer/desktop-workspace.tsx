import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DraftRecoveryPrompt, LeaveDialog, type LeaveChoice } from "@uniwork/views/office/leave-dialog";
import { desktopFileResponseSchema, desktopLibraryContextResponseSchema, desktopOfficeOpenResponseSchema, desktopTabsUpdateResponseSchema, type DesktopLibraryContextResponse, type DesktopLibraryDocument, type DesktopSessionMetadata } from "../shared/ipc";
import type { RendererBridge } from "./app";
import { LoginScreen } from "./login-screen";
import type { LoginScreenState } from "./login";
import { LibraryHost } from "./library/host";
import { LibraryPicker, type LibraryPickerSelection } from "./library/picker";
import { LocalHomeView } from "./local-home";
import { OpenByteDocument } from "./office/open-document";
import { DOCUMENT_TAB_LIMIT } from "./tabs/tab-model";
import { isDocumentDirty, useDocumentTabs } from "./tabs/use-document-tabs";
import { RecoveryNotice } from "./recovery-status";
import { DesktopShell } from "./desktop-shell";
import { DesktopTabStrip } from "./tab-strip";
import { useAccountDrafts } from "./use-account-drafts";
import { useLocalRecents } from "./use-local-recents";

const SESSION_GENERATION = "desktop-dev-session";
export type SignedInMetadata = DesktopSessionMetadata & { status: "signed-in"; accountId: string; deploymentId: string };
type HostLeave = { requestId: string; reason: "close" | "logout" | "update" };
type PendingLeave = { ids: readonly string[]; host?: HostLeave; switchWorkspace?: boolean };
type NativeOpenRequest = { kind: "file"; handle: string } | { kind: "launch"; documentId: string; operation: "view" | "edit"; version?: number };

const noop = () => undefined;

export interface DesktopWorkspaceProps {
  bridge: RendererBridge;
  mode: "login" | "local" | "signed-in";
  metadata?: SignedInMetadata;
  loginState: LoginScreenState;
  /** Named cause of a locked store, forwarded to the sign-in card. */
  loginLockedReason?: "keyring";
  onLoginStart: () => void;
  onLoginCancel: () => void;
  onUseLocal: (entry: "home" | "open-local") => void;
  onSignIn: () => void;
  onLogout: () => void | Promise<void>;
  openLocalRequest: number;
}

/** The one window that owns document tabs in both modes. Cloud tabs belong to
 * the signed-in account; local device tabs and their protected drafts survive
 * sign-in and sign-out because this component never unmounts for a mode change. */
export function DesktopWorkspace({ bridge, mode, metadata, loginState, loginLockedReason, onLoginStart, onLoginCancel, onUseLocal, onSignIn, onLogout, openLocalRequest }: DesktopWorkspaceProps) {
  const { t } = useTranslation();
  const signedIn = mode === "signed-in" && Boolean(metadata);
  const tabs = useDocumentTabs(bridge);
  const currentTabs = tabs.current;
  const accountDrafts = useAccountDrafts(bridge, mode === "signed-in");
  const recents = useLocalRecents(bridge, mode === "local");
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
  const [pendingOpens, setPendingOpens] = useState<readonly NativeOpenRequest[]>([]);
  const [syncError, setSyncError] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onSignInRef = useRef(onSignIn);
  onSignInRef.current = onSignIn;
  const onUseLocalRef = useRef(onUseLocal);
  onUseLocalRef.current = onUseLocal;
  const loginCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode === "login") loginCardRef.current?.focus();
  }, [mode]);

  useEffect(() => () => { mounted.current = false; ++lifetime.current; }, []);

  // The library context is a cloud read: it only ever runs signed in.
  useEffect(() => {
    if (mode !== "signed-in") return;
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
  }, [bridge, mode, contextReload]);

  // Serialize native tab registration so an old acknowledgement cannot replace
  // the active tab after a rapid switch. Main validates every document id.
  const syncQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (mode === "login") return;
    syncQueue.current = syncQueue.current.catch(() => undefined).then(async () => {
      if (!mounted.current) return;
      try {
        const live = currentTabs.current;
        const result = desktopTabsUpdateResponseSchema.parse(await bridge.call("desktop:tabs-update", { sessionGeneration: SESSION_GENERATION, documentIds: live.tabs.map((tab) => tab.id), activeDocumentId: live.activeTabId }));
        if (!result.updated) throw new Error("tab_registration_refused");
        if (mounted.current) setSyncError(false);
      } catch { if (mounted.current) setSyncError(true); }
    });
  }, [bridge, tabs.tabs, tabs.activeTabId, currentTabs, mode]);

  // An account change voids its cloud work; local-device tabs stay untouched.
  const accountKey = signedIn && metadata ? `${metadata.deploymentId}:${metadata.accountId}` : undefined;
  const previousAccount = useRef<string | undefined>(accountKey);
  useEffect(() => {
    const previous = previousAccount.current;
    previousAccount.current = accountKey;
    if (previous !== undefined && previous !== accountKey) tabs.closeCloud();
  // The tab set is read through its live ref so this only reacts to the account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

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
    if (tabs.open({ kind: "cloud", title: result.document.title, format: result.document.format, bytes: { ...result, canSave: allowSave && result.document.canEdit }, identity: { ...selected, documentId: result.document.id, generation: lifetime.current + 1, baseRevision: result.document.revision, baseVersionId: String(result.document.version) } }) === "limit") setActionError(t("officeDesktop.tabs.limit"));
  };
  const acceptLocal = (raw: unknown) => {
    const result = desktopFileResponseSchema.parse(raw);
    if (!result.opened) {
      // Typed non-throwing answers: a recent whose file vanished and a
      // non-docx pick each get their own copy instead of a guessed error code.
      if (result.missing) setActionError(t("officeDesktop.local.missing"));
      else if (result.unsupported) setActionError(t("officeDesktop.local.unsupported"));
      return;
    }
    if (!result.metadata || !result.dataBase64) throw new Error("invalid_file");
    const file = result.metadata;
    if (!/\.docx$/i.test(file.name)) { setActionError(t("officeDesktop.local.unsupported")); return; }
    const title = file.untitled ? t("officeDesktop.local.untitled") : file.name;
    if (tabs.open({ kind: "local", title, format: "docx", bytes: { dataBase64: result.dataBase64, checksum: file.checksum, localHandle: file.handle, localUntitled: file.untitled === true }, identity: { deploymentId: "local", accountId: "local", organizationId: "local", workspaceId: "local", documentId: file.handle, generation: lifetime.current + 1, baseRevision: String(Math.trunc(file.modifiedAtMs)), baseVersionId: file.checksum } }) === "limit") setActionError(t("officeDesktop.tabs.limit"));
    if (modeRef.current === "local") recents.reload();
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
  const openLocal = () => { if (canOpen()) void perform(() => bridge.call("desktop:file-pick-open", { sessionGeneration: SESSION_GENERATION }), acceptLocal); };
  const createLocal = () => { if (canOpen()) void perform(() => bridge.call("desktop:file-create", { sessionGeneration: SESSION_GENERATION }), acceptLocal); };
  const openRecent = (id: string) => {
    if (!canOpen()) return;
    void perform(() => bridge.call("desktop:recent-open", { sessionGeneration: SESSION_GENERATION, id }), acceptLocal).then(() => recents.reload());
  };
  const create = () => {
    if (modeRef.current === "local") { createLocal(); return; }
    const selected = scopeRef.current;
    if (!selected || !canOpen()) return;
    void perform(() => bridge.call("desktop:library-create", { sessionGeneration: SESSION_GENERATION, workspaceId: selected.workspaceId, title: t("officeDesktop.library.untitled") }), (raw) => acceptCloud(raw, selected));
  };
  const openLocalRef = useRef(openLocal);
  openLocalRef.current = openLocal;
  const openLocalTicket = useRef(0);
  useEffect(() => {
    if (mode !== "local" || openLocalRequest === 0 || openLocalRequest === openLocalTicket.current) return;
    // A blocked moment (busy open, leave dialog) keeps the ticket queued
    // instead of silently dropping the user's pick request.
    if (busy || leave) return;
    openLocalTicket.current = openLocalRequest;
    openLocalRef.current();
  }, [mode, openLocalRequest, busy, leave]);

  const sendHostAnswer = async (request: HostLeave, choice: LeaveChoice, proceeded: boolean) => {
    if (answered.current.has(request.requestId)) return;
    answered.current.add(request.requestId);
    try { await bridge.call("desktop:leave-resolved", { sessionGeneration: SESSION_GENERATION, requestId: request.requestId, choice, proceeded }); }
    catch { if (mounted.current) setActionError(t("officeDesktop.library.actionError")); }
  };
  // A workspace switch is a cloud-scope change: local-device tabs stay open.
  const switchWorkspace = () => { ++lifetime.current; tabs.closeCloud(); setScope(null); setPendingOpens([]); };
  const requestLeave = (request: PendingLeave) => {
    if (leaveRef.current) {
      if (request.host) void sendHostAnswer(request.host, "stay", false);
      return;
    }
    const affected = tabs.current.current.tabs.filter((tab) => request.ids.includes(tab.id));
    if (affected.some((tab) => tab.data.session.coordinator.getState().state === "saving")) {
      if (request.host) void sendHostAnswer(request.host, "stay", false);
      return;
    }
    const dirty = affected.some((tab) => isDocumentDirty(tab.data.session));
    if (!dirty) {
      if (request.host) void sendHostAnswer(request.host, "keep", true);
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
    const offLeave = bridge.onLeaveRequested?.((host) => {
      // Logout keeps local-device tabs; close/update must settle every tab.
      const ids = host.reason === "logout"
        ? tabs.current.current.tabs.filter((tab) => tab.data.kind === "cloud").map((tab) => tab.id)
        : tabs.current.current.tabs.map((tab) => tab.id);
      handlers.current.requestLeave({ ids, host });
    });
    const offLaunch = bridge.onLaunchRequested?.((event) => setPendingOpens((previous) => [...previous, { kind: "launch", ...event }]));
    const offFile = bridge.onFileOpenRequested?.((event) => {
      // An OS open while signed out enters the local mode directly.
      if (modeRef.current !== "signed-in") onUseLocalRef.current("home");
      setPendingOpens((previous) => [...previous, { kind: "file", handle: event.handle }]);
    });
    const offSave = bridge.onOfficeSaveRequested?.((event) => {
      const active = tabs.current.current.tabs.find((tab) => tab.id === tabs.current.current.activeTabId);
      if (active?.id === event.documentId && !leaveRef.current && !document.querySelector('[role="dialog"]')) void active.data.session.coordinator.save("menu");
    });
    const shortcut = (event: KeyboardEvent) => {
      if (modeRef.current === "login") return;
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
  // The mode subscriptions use live refs for tabs and handlers above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);
  useEffect(() => {
    const request = pendingOpens[0];
    if (!request || busy || actionBusy.current || leave || mode === "login") return;
    if (request.kind === "launch" && mode !== "signed-in") { setPendingOpens((previous) => previous.slice(1)); onSignInRef.current(); return; }
    if (request.kind === "launch" && !scope) return;
    setPendingOpens((previous) => previous.slice(1));
    if (request.kind === "file") {
      if (canOpen(request.handle)) void perform(() => bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle: request.handle }), handlers.current.acceptLocal);
    } else if (scope && canOpen(request.documentId)) {
      const selected = scope;
      void perform(() => bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: selected.workspaceId, documentId: request.documentId, ...(request.version === undefined ? {} : { version: request.version }) }), (raw) => acceptCloud(raw, selected, request.operation === "edit"));
    }
  // One FIFO preserves the order of file and launch requests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpens, scope, busy, leave, mode]);

  // Dialogs and alerts have no mode dependency: the leave contract must hold
  // while the sign-in card is shown too (close/update, deep-link prompt).
  const affected = tabs.tabs.filter((tab) => leave?.ids.includes(tab.id));
  const deviceLeaveSet = affected.length > 0 && affected.every((tab) => tab.data.kind === "local");
  const alerts = <>
    {actionError ? <p role="alert" className="p-4 text-body text-destructive">{actionError}</p> : null}
    {syncError ? <p role="alert" className="px-4 py-2 text-body text-destructive">{t("officeDesktop.tabs.sessionError")}</p> : null}
    {tabs.checkpointFailures.length > 0 ? <p role="alert" className="px-4 py-2 text-body text-destructive">{t("officeDesktop.tabs.checkpointFailed")}</p> : null}
  </>;
  const leaveDialog = <LeaveDialog open={leave !== null} dirty={affected.some((tab) => isDocumentDirty(tab.data.session))} saving={affected.some((tab) => tab.data.session.coordinator.getState().state === "saving")}
    saveLabel={deviceLeaveSet ? t("officeDesktop.local.leaveSave") : undefined}
    onOpenChange={(open) => { if (!open && leaveRef.current) finishLeave("stay"); }} onSave={() => runLeaveAction("save")} onKeepDraft={() => runLeaveAction("keep")} onDiscard={() => runLeaveAction("discard")} onChoice={finishLeave} />;

  const account = context?.accounts.find((entry) => entry.id === metadata?.accountId);
  const workspace = context?.workspaces.find((entry) => entry.id === scope?.workspaceId);
  const homeKind = mode === "local" ? "local" : "library";
  const workspaceView = <DesktopShell mode={mode === "signed-in" ? "signed-in" : "local"} onSignIn={mode !== "signed-in" ? onSignIn : undefined} onSignOut={mode === "signed-in" ? () => { void Promise.resolve().then(onLogout).catch(() => setActionError(t("officeDesktop.library.actionError"))); } : undefined}
    accountName={mode === "signed-in" ? account?.name : undefined} accountEmail={mode === "signed-in" ? account?.email : undefined} workspaceName={workspace?.name} onSwitchWorkspace={mode === "signed-in" ? () => requestLeave({ ids: tabs.cloudTabIds(), switchWorkspace: true }) : undefined}
    tabs={tabs.summaries} activeTabId={tabs.activeTabId} onTabSelect={tabs.select} onTabClose={close} onCreate={create} onOpenLocal={openLocal}
    createDisabled={mode === "signed-in" && !scope} busy={busy || leave !== null}>
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
      event.preventDefault(); const file = event.dataTransfer.files[0];
      if (file && bridge.openDroppedFile && canOpen()) void perform(() => bridge.openDroppedFile!(file), acceptLocal);
    }}>
      {mode !== "login" ? alerts : null}
      <div role="tabpanel" id={`desktop-panel-${homeKind}`} aria-labelledby={`desktop-tab-${homeKind}`} hidden={tabs.activeTabId !== null} inert={tabs.activeTabId !== null} className="min-h-0 flex-1 flex-col data-[active=true]:flex" data-active={tabs.activeTabId === null}>
        {mode === "local"
          ? <LocalHomeView files={recents.files} error={recents.error} busy={busy} onOpen={openLocal} onCreate={createLocal} onOpenRecent={openRecent} onRemoveRecent={(id) => { void recents.remove(id).then((removed) => { if (!removed) setActionError(t("officeDesktop.library.actionError")); }); }} onRetry={recents.reload} />
          : scope ? <LibraryHost bridge={bridge} scope={{ ...metadata!, ...scope }} onCreate={create} onOpenLocal={openLocal} onOpen={openCloud} /> : <LibraryPicker context={context} error={contextError} onRetry={() => setContextReload((value) => value + 1)} onChoose={setScope} />}
      </div>
      {tabs.tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`desktop-panel-${tab.id}`} aria-labelledby={`desktop-tab-${tab.id}`} hidden={tabs.activeTabId !== tab.id} inert={tabs.activeTabId !== tab.id} className="min-h-0 flex-1 flex-col data-[active=true]:flex" data-active={tabs.activeTabId === tab.id}>
        <OpenByteDocument bridge={bridge} identity={tab.data.identity} session={tab.data.session} title={tab.title} active={mode !== "login" && tabs.activeTabId === tab.id} kind={tab.data.kind} signedIn={mode === "signed-in"} onSignIn={onSignIn} onBack={() => tabs.select(null)} />
      </div>)}
    </div>
    {accountDrafts.blocked ? <RecoveryNotice state={accountDrafts.blocked} className="p-4" /> : null}
    {accountDrafts.draft && tabs.tabs.length === 0 ? <DraftRecoveryPrompt open metadata={accountDrafts.draft} recoverable={false} onOpenChange={(open) => { if (!open) accountDrafts.dismiss(); }} onRecover={async () => false} onKeep={async () => { accountDrafts.dismiss(); return true; }} onDiscard={accountDrafts.discard} /> : null}
    {mode !== "login" ? leaveDialog : null}
  </DesktopShell>;
  return <>
    <div className={mode === "login" ? "hidden" : "h-full min-h-0"} aria-hidden={mode === "login"} inert={mode === "login"}>
      {workspaceView}
    </div>
    {mode === "login" ? <div ref={loginCardRef} tabIndex={-1} className="flex h-full min-h-0 flex-col outline-none" aria-label={t("officeDesktop.login.title")}>
      <DesktopTabStrip signedOut tabs={[]} activeTabId={null} onSelect={noop} onClose={noop} onCreate={noop} onOpenLocal={noop} onSignOut={noop} />
      {alerts}
      <LoginScreen state={loginState} lockedReason={loginLockedReason} onStart={onLoginStart} onCancel={onLoginCancel} onOpenLocal={() => onUseLocal("open-local")} onUseLocal={() => onUseLocal("home")} />
      {leaveDialog}
    </div> : null}
  </>;
}
