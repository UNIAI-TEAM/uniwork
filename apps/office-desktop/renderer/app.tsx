import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeIdentity } from "@uniwork/core/office";
import {
  desktopAuthConfigResponseSchema,
  desktopLibraryContextResponseSchema,
  desktopSessionMetadataSchema,
} from "../shared/ipc";
import type {
  DesktopIpcChannel,
  DesktopIpcRequest,
  DesktopLibraryContextResponse,
  DesktopLibraryDocument,
  DesktopSessionMetadata,
} from "../shared/ipc";
import { desktopFileResponseSchema, desktopDraftListResponseSchema, desktopOfficeOpenResponseSchema, desktopLibraryDownloadResponseSchema } from "../shared/ipc";
import { DraftRecoveryPrompt, LeaveDialog } from "@uniwork/views/office/leave-dialog";
import { createLibraryController, createLibraryScopeController, type LibraryMode } from "./library/model";
import { LibraryPicker, type LibraryPickerSelection } from "./library/picker";
import { LibraryView } from "./library/view";
import { createLoginController, loginStateFromMetadata, type LoginScreenState } from "./login";
import { LoginScreen } from "./login-screen";
import { SignedInShell } from "./signed-in-shell";
import { OpenByteDocument } from "./office/open-document";
import { createByteDocumentSession, type ByteDocumentSession, type OpenedBytes } from "./office/session";

const SESSION_GENERATION = "desktop-dev-session";

export type RendererBridge = Readonly<{
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  onSessionChanged(listener: (metadata: DesktopSessionMetadata) => void): () => void;
  onLaunchRequested?(listener: (event: { documentId: string; operation: "view" | "edit"; version?: number }) => void): () => void;
  onOfficeSaveRequested?(listener: (event: { documentId: string }) => void): () => void;
  onLeaveRequested?(listener: (event: { requestId: string; reason: "close" | "logout" | "update" }) => void): () => void;
  openDroppedFile?(file: File): Promise<unknown>;
  onFileOpenRequested?(listener: (event: { handle: string }) => void): () => void;
}>;

type SignedInMetadata = DesktopSessionMetadata & { status: "signed-in"; accountId: string; deploymentId: string };
type Scope = SignedInMetadata & { organizationId?: string; workspaceId?: string };

function isSessionMetadata(value: unknown): value is DesktopSessionMetadata {
  return desktopSessionMetadataSchema.safeParse(value).success;
}
function isAuthConfig(value: unknown): value is { clientId: string; deploymentId: string } {
  return desktopAuthConfigResponseSchema.safeParse(value).success;
}
function isLibraryContext(value: unknown): value is DesktopLibraryContextResponse {
  return desktopLibraryContextResponseSchema.safeParse(value).success;
}

/** Scope picked plus its workspace library, between sign-in and opening a
 * document. Kept separate from the DOCX host, which mounts once a document
 * is chosen. */
function LibraryHost({ bridge, scope, onOpen, onCreate, onOpenLocal }: { bridge: RendererBridge; scope: Scope & { organizationId: string; workspaceId: string }; onOpen: (document: DesktopLibraryDocument) => void; onCreate: () => void; onOpenLocal: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [mode, setMode] = useState<LibraryMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [result, setResult] = useState<{ documents: DesktopLibraryDocument[]; engineAvailable: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [downloadError, setDownloadError] = useState(false);
  const scopeController = useMemo(() => createLibraryScopeController({ deploymentId: scope.deploymentId, accountId: scope.accountId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, sessionGeneration: SESSION_GENERATION }), [scope.accountId, scope.deploymentId, scope.organizationId, scope.workspaceId]);
  const controller = useMemo(() => createLibraryController(bridge, scopeController), [bridge, scopeController]);
  const drawSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestSequence = ++drawSequence.current;
    setResult(null);
    setError(false);
    const run = mode === "list" ? controller.list() : mode === "recent" ? controller.recent() : searchQuery.trim() ? controller.search(searchQuery.trim()) : Promise.resolve({ documents: [], nextCursor: null, engineAvailable: true, generation: 0 });
    void run
      .then((next) => {
        if (!active || requestSequence !== drawSequence.current) return;
        setResult({ documents: next.documents, engineAvailable: next.engineAvailable });
        setError(false);
      })
      .catch(() => {
        if (!active || requestSequence !== drawSequence.current) return;
        setResult(null);
        setError(true);
      });
    return () => { active = false; };
  }, [controller, mode, searchQuery, reload]);

  return (
    <>{downloadError ? <p role="alert" className="px-6 text-destructive">{t("actionError")}</p> : null}<LibraryView
      mode={mode}
      searchQuery={searchQuery}
      documents={result?.documents ?? []}
      engineAvailable={result?.engineAvailable ?? true}
      loading={result === null && !error}
      error={error}
      onRetry={() => setReload((value) => value + 1)}
      onModeChange={setMode}
      onSearch={setSearchQuery}
      onOpen={onOpen}
      onDownload={(document) => {
        setDownloadError(false);
        void bridge.call("desktop:library-download", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version }).then((raw) => {
          const result = desktopLibraryDownloadResponseSchema.parse(raw);
          const bytes = Uint8Array.from(atob(result.dataBase64), (character) => character.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
          const link = window.document.createElement("a"); link.href = url; link.download = result.filename;
          window.document.body.append(link); link.click(); link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }).catch(() => setDownloadError(true));
      }}
      onCreate={onCreate}
      onOpenLocal={onOpenLocal}
    /></>
  );
}

function SignedIn({ bridge, metadata, onLogout }: { bridge: RendererBridge; metadata: SignedInMetadata; onLogout: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.library" });
  const [scope, setScope] = useState<LibraryPickerSelection | null>(null);
  const [opened, setOpened] = useState<{ identity: OfficeIdentity; bytes: OpenedBytes; title: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leave, setLeave] = useState<{ requestId: string; reason: "close" | "logout" | "update" } | null>(null);
  const [accountDraft, setAccountDraft] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState<{ documentId: string; operation: "view" | "edit"; version?: number } | null>(null);
  const [queuedFileOpen, setQueuedFileOpen] = useState<string | null>(null);
  const openSequence = useRef(0);
  const actionRef = useRef({ scope, opened });
  actionRef.current = { scope, opened };
  const [context, setContext] = useState<DesktopLibraryContextResponse | null>(null);
  const [contextError, setContextError] = useState(false);
  const [contextReload, setContextReload] = useState(0);

  useEffect(() => {
    let active = true;
    setContextError(false);
    void bridge.call("desktop:library-context", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      if (!active) return;
      if (isLibraryContext(raw)) {
        setContext(raw);
        if (["deployments", "accounts", "organizations", "workspaces"].every((group) => raw[group as keyof DesktopLibraryContextResponse].length === 1)) {
          setScope({ deploymentId: raw.deployments[0]!.id, accountId: raw.accounts[0]!.id, organizationId: raw.organizations[0]!.id, workspaceId: raw.workspaces[0]!.id });
        }
      } else setContextError(true);
    }).catch(() => { if (active) setContextError(true); });
    return () => { active = false; };
  }, [bridge, contextReload]);

  const account = context?.accounts.find((entry) => entry.id === (scope?.accountId ?? metadata.accountId));
  const workspace = context?.workspaces.find((entry) => entry.id === scope?.workspaceId);
  const session = useMemo(() => (opened ? createByteDocumentSession(bridge, opened.identity, opened.bytes) : null), [bridge, opened]);
  useEffect(() => {
    // Main owns the leave decision; this component renders the ONE shared
    // dialog and reports the outcome through the guarded IPC channels.
    return bridge.onLeaveRequested?.(setLeave);
  }, [bridge]);
  useEffect(() => {
    let active = true;
    void bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      if (!active) return;
      try { setAccountDraft(desktopDraftListResponseSchema.parse(raw).drafts.length > 0); } catch { setAccountDraft(false); }
    }).catch(() => { if (active) setAccountDraft(false); });
    return () => { active = false; };
  }, [bridge]);
  useEffect(() => {
    // The 2 s tick is a LOCAL draft checkpoint only: it never uploads or
    // commits, and it gives main durable evidence of unsaved work.
    if (!session) return;
    const timer = window.setInterval(() => {
      if (session.coordinator.getState().state === "dirty") void session.keepDraft();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [session]);
  const answerLeave = async (choice: "save" | "keep" | "discard" | "stay", proceeded: boolean) => {
    const request = leave;
    setLeave(null);
    if (!request) return;
    try { await bridge.call("desktop:leave-resolved", { sessionGeneration: SESSION_GENERATION, requestId: request.requestId, choice, proceeded }); } catch { /* main fails closed on timeout */ }
  };
  const acceptCloud = (raw: unknown, selected: LibraryPickerSelection, allowSave = true) => {
    const current = actionRef.current.scope;
    if (!current || current.workspaceId !== selected.workspaceId || current.accountId !== selected.accountId || current.deploymentId !== selected.deploymentId) return;
    const result = desktopOfficeOpenResponseSchema.parse(raw);
    if (result.document.workspaceId !== selected.workspaceId) throw new Error("workspace_mismatch");
    setOpened({ title: result.document.title, bytes: { ...result, canSave: allowSave && result.document.canEdit }, identity: { ...selected, documentId: result.document.id, generation: 1, baseRevision: result.document.revision, baseVersionId: String(result.document.version) } });
  };
  const acceptLocal = (raw: unknown) => {
    const result = desktopFileResponseSchema.parse(raw);
    if (!result.opened) return;
    if (!result.metadata || !result.dataBase64) throw new Error("invalid_file");
    if (!/\.docx$/i.test(result.metadata.name)) { setActionError(t("unsupported")); return; }
    setOpened({ title: result.metadata.name, bytes: { dataBase64: result.dataBase64, checksum: result.metadata.checksum, localHandle: result.metadata.handle }, identity: { deploymentId: metadata.deploymentId, accountId: metadata.accountId, organizationId: "local", workspaceId: "local", documentId: result.metadata.handle, generation: 1, baseRevision: "0", baseVersionId: result.metadata.checksum } });
  };
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setActionError(null);
    try { await operation(); } catch { setActionError(t("actionError")); } finally { setBusy(false); }
  };
  const openCreated = async () => {
    if (!scope) return;
    acceptCloud(await bridge.call("desktop:library-create", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, title: t("untitled") }), scope);
  };
  const openLocal = async () => {
    const raw = await bridge.call("desktop:file-pick-open", { sessionGeneration: SESSION_GENERATION });
    acceptLocal(raw);
  };
  useEffect(() => {
    const unsubscribe = bridge.onLaunchRequested?.(setPendingLaunch);
    const unsubscribeFile = bridge.onFileOpenRequested?.((event) => {
      if (actionRef.current.opened) { setQueuedFileOpen(event.handle); return; }
      void bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle: event.handle }).then(acceptLocal).catch(() => setActionError(t("actionError")));
    });
    return () => { unsubscribe?.(); unsubscribeFile?.(); };
  // The subscriptions read live selection through actionRef and persist per account.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, metadata.accountId]);
  useEffect(() => {
    if (opened || queuedFileOpen === null) return;
    const handle = queuedFileOpen;
    setQueuedFileOpen(null);
    void bridge.call("desktop:file-open", { sessionGeneration: SESSION_GENERATION, handle }).then(acceptLocal).catch(() => setActionError(t("actionError")));
  // A queued open waits for the current document to settle; acceptLocal writes state only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, opened, queuedFileOpen]);
  useEffect(() => {
    if (!pendingLaunch || !scope || opened) return;
    let active = true;
    const sequence = ++openSequence.current;
    void bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: pendingLaunch.documentId, ...(pendingLaunch.version === undefined ? {} : { version: pendingLaunch.version }) }).then((raw) => {
      if (active && sequence === openSequence.current) { acceptCloud(raw, scope, pendingLaunch.operation === "edit"); setPendingLaunch(null); }
    }).catch(() => { if (active) { setPendingLaunch(null); setActionError(t("actionError")); } });
    return () => { active = false; };
  // Selection and pending ticket determine the lifetime; acceptCloud writes state only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, pendingLaunch, scope, opened]);
  return (
    <SignedInShell onSignOut={onLogout} accountName={account?.name} accountEmail={account?.email} workspaceName={workspace?.name} onSwitchWorkspace={() => { ++openSequence.current; setOpened(null); setScope(null); }}>
      <div className="flex min-h-0 flex-1 flex-col" aria-busy={busy} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && bridge.openDroppedFile && !opened) void perform(async () => acceptLocal(await bridge.openDroppedFile!(file))); }}>
      {actionError ? <p role="alert" className="p-4 text-destructive">{actionError}</p> : null}
      {queuedFileOpen !== null ? <p role="status" className="px-4 pb-2 text-body text-muted-foreground">{t("fileOpenQueued")}</p> : null}
      {opened && session ? <OpenByteDocument bridge={bridge} identity={opened.identity} session={session} title={opened.title} onBack={() => setOpened(null)} /> : scope ? (
        <LibraryHost bridge={bridge} scope={{ ...metadata, ...scope }} onCreate={() => { void perform(openCreated); }} onOpenLocal={() => { void perform(openLocal); }} onOpen={(document) => { void perform(async () => acceptCloud(await bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version }), scope)); }} />
      ) : (
        <LibraryPicker context={context} error={contextError} onRetry={() => setContextReload((value) => value + 1)} onChoose={setScope} />
      )}</div>
      {accountDraft && !opened ? <DraftRecoveryPrompt open metadata={null} recoverable={false}
        onOpenChange={(open) => { if (!open) setAccountDraft(false); }}
        onRecover={async () => false}
        onKeep={async () => { setAccountDraft(false); return true; }}
        onDiscard={async () => {
          try {
            const listed = desktopDraftListResponseSchema.parse(await bridge.call("desktop:draft-list", { sessionGeneration: SESSION_GENERATION }));
            const newest = [...listed.drafts].sort((left, right) => right.updatedAt - left.updatedAt)[0];
            if (newest) await bridge.call("desktop:draft-discard", { sessionGeneration: SESSION_GENERATION, draftId: newest.draftId, generation: newest.generation });
          } catch { return false; }
          setAccountDraft(false);
          return true;
        }} /> : null}
      <LeaveDialog open={leave !== null} dirty={Boolean(session) && leaveDecisionDirty(session)}
        saving={leaveDecisionSaving(session)}
        onOpenChange={(open) => { if (!open && leave) void answerLeave("stay", false); }}
        onSave={async () => {
          if (!session) return true;
          const state = session.coordinator.getState();
          // A clean document has nothing to write; leaving is not blocked by it.
          if (state.state === "ready" || state.state === "saved") return true;
          const result = await session.coordinator.save("dialog");
          return result.accepted;
        }}
        onKeepDraft={async () => (session ? session.keepDraft() : true)}
        onDiscard={async () => (session ? session.discardDraft() : true)}
        onChoice={(choice) => { void answerLeave(choice, choice !== "stay"); }} />
    </SignedInShell>
  );
}

function leaveDecisionDirty(session: ByteDocumentSession | null): boolean {
  if (!session) return false;
  const state = session.coordinator.getState();
  return state.state === "dirty" || state.state === "error" || state.state === "blocked" || state.state === "conflict";
}

function leaveDecisionSaving(session: ByteDocumentSession | null): boolean {
  return session?.coordinator.getState().state === "saving";
}

/** Top-level renderer app: the auth state machine from `login.ts` decides
 * between the sign-in card and the signed-in shell. No token ever enters
 * this tree; `bridge` only returns session metadata and opaque command
 * results. */
export function App({ bridge }: { bridge: RendererBridge }) {
  const [state, setState] = useState<LoginScreenState>("signed-out");
  const [metadata, setMetadata] = useState<DesktopSessionMetadata | undefined>(undefined);
  const controllerRef = useRef<ReturnType<typeof createLoginController> | undefined>(undefined);
  const metadataRef = useRef<DesktopSessionMetadata | undefined>(undefined);

  useEffect(() => {
    let unsubscribeController: (() => void) | undefined;
    const unsubscribe = bridge.onSessionChanged((next) => {
      controllerRef.current?.clearExpiry();
      metadataRef.current = next;
      setMetadata(next);
      setState(loginStateFromMetadata(next));
    });
    void (async () => {
      try {
        const config = await bridge.call("desktop:auth-config", { sessionGeneration: SESSION_GENERATION });
        if (!isAuthConfig(config)) throw new Error("invalid auth config");
        controllerRef.current = createLoginController(bridge, SESSION_GENERATION, config.clientId, config.deploymentId);
        unsubscribeController = controllerRef.current.subscribe(setState);
        const session = await bridge.call("desktop:auth-session", { sessionGeneration: SESSION_GENERATION });
        if (!isSessionMetadata(session)) throw new Error("invalid session metadata");
        setMetadata(session);
        metadataRef.current = session;
        setState(loginStateFromMetadata(session));
      } catch {
        setState("error");
      }
    })();
    return () => { unsubscribe(); unsubscribeController?.(); };
  }, [bridge]);

  if (state === "signed-in" && metadata?.status === "signed-in" && metadata.accountId && metadata.deploymentId) {
    return (
      <SignedIn
        key={`${metadata.deploymentId}:${metadata.accountId}`}
        bridge={bridge}
        metadata={metadata as SignedInMetadata}
        onLogout={() => {
          void bridge
            .call("desktop:auth-logout", { sessionGeneration: SESSION_GENERATION, scope: "device" })
            .then((next) => {
              if (isSessionMetadata(next)) {
                setMetadata(next);
                setState(loginStateFromMetadata(next));
              }
            })
            .catch(() => setState("error"));
        }}
      />
    );
  }

  return (
    <LoginScreen
      state={state}
      onStart={() => {
        if (!controllerRef.current) return;
        setState("pending");
        void controllerRef.current?.start().then(setState);
      }}
      onCancel={() => {
        void controllerRef.current?.cancel().then(setState).catch(() => setState("error"));
      }}
    />
  );
}
