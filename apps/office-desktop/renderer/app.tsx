import { useEffect, useMemo, useRef, useState } from "react";
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
import { createLibraryController, createLibraryScopeController, type LibraryMode } from "./library/model";
import { LibraryPicker, type LibraryPickerSelection } from "./library/picker";
import { LibraryView } from "./library/view";
import { createLoginController, loginStateFromMetadata, type LoginScreenState } from "./login";
import { LoginScreen } from "./login-screen";
import { SignedInShell } from "./signed-in-shell";
import { Button } from "@uniwork/ui/components/ui/button";
import { OfficeShell } from "@uniwork/views/office/office-shell";
import { EditorSlot } from "@uniwork/views/office/editor-slot";
import { createDesktopOfficeHost } from "./office/host";

const SESSION_GENERATION = "desktop-dev-session";

export type RendererBridge = Readonly<{
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  onSessionChanged(listener: (metadata: DesktopSessionMetadata) => void): () => void;
  onLaunchRequested?(listener: (event: { documentId: string; operation: "view" | "edit"; version?: number }) => void): () => void;
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
function LibraryHost({ bridge, scope, onOpen }: { bridge: RendererBridge; scope: Scope & { organizationId: string; workspaceId: string }; onOpen: (document: DesktopLibraryDocument) => void }) {
  const [mode, setMode] = useState<LibraryMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [result, setResult] = useState<{ documents: DesktopLibraryDocument[]; engineAvailable: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const scopeController = useMemo(() => createLibraryScopeController({ deploymentId: scope.deploymentId, accountId: scope.accountId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, sessionGeneration: SESSION_GENERATION }), [scope.accountId, scope.deploymentId, scope.organizationId, scope.workspaceId]);
  const controller = useMemo(() => createLibraryController(bridge, scopeController), [bridge, scopeController]);
  const drawSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestSequence = ++drawSequence.current;
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
    <LibraryView
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
        void bridge.call("desktop:library-download", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version });
      }}
    />
  );
}

function OpenDocument({ bridge, scope, document, onBack }: { bridge: RendererBridge; scope: Scope & { organizationId: string; workspaceId: string }; document: DesktopLibraryDocument; onBack: () => void }) {
  const host = useMemo(() => createDesktopOfficeHost({ bridge, context: { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version } }), [bridge, document.id, document.version, scope.workspaceId]);
  return <OfficeShell title={document.title} breadcrumbs={[{ label: "Documents" }]} actions={<Button type="button" variant="outline" size="sm" onClick={onBack}>Back to library</Button>} editor={<EditorSlot format="docx" host={host as never} capability={{ format: "docx", operation: "open", host: "desktop", engineBuild: "desktop", contractRevision: "desktop/1", status: "available", fidelityWarnings: [] }} openState="ready" />} editorReady={false} />;
}

function SignedIn({ bridge, metadata, onLogout }: { bridge: RendererBridge; metadata: SignedInMetadata; onLogout: () => void }) {
  const [scope, setScope] = useState<LibraryPickerSelection | null>(null);
  const [openedDocument, setOpenedDocument] = useState<DesktopLibraryDocument | null>(null);
  const [context, setContext] = useState<DesktopLibraryContextResponse | null>(null);
  const [contextError, setContextError] = useState(false);
  const [contextReload, setContextReload] = useState(0);

  useEffect(() => {
    let active = true;
    setContextError(false);
    void bridge.call("desktop:library-context", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      if (!active) return;
      if (isLibraryContext(raw)) setContext(raw); else setContextError(true);
    }).catch(() => { if (active) setContextError(true); });
    return () => { active = false; };
  }, [bridge, contextReload]);

  const account = context?.accounts.find((entry) => entry.id === (scope?.accountId ?? metadata.accountId));
  const workspace = context?.workspaces.find((entry) => entry.id === scope?.workspaceId);
  return (
    <SignedInShell onSignOut={onLogout} accountName={account?.name} workspaceName={workspace?.name}>
      {scope ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto"><LibraryHost bridge={bridge} scope={{ ...metadata, ...scope }} onOpen={(document) => { setOpenedDocument(document); void bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version }); }} />{openedDocument ? <OpenDocument bridge={bridge} scope={{ ...metadata, ...scope }} document={openedDocument} onBack={() => setOpenedDocument(null)} /> : null}</div>
      ) : (
        <LibraryPicker context={context} error={contextError} onRetry={() => setContextReload((value) => value + 1)} onChoose={setScope} />
      )}
    </SignedInShell>
  );
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
    const unsubscribe = bridge.onSessionChanged((next) => {
      metadataRef.current = next;
      setMetadata(next);
      setState(loginStateFromMetadata(next));
    });
    const unsubscribeLaunch = bridge.onLaunchRequested?.((event) => {
      const current = metadataRef.current;
      const workspaceId = current?.status === "signed-in" ? current.workspaceId : undefined;
      if (!workspaceId) return;
      void bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId, documentId: event.documentId, ...(event.version === undefined ? {} : { version: event.version }) });
    });
    void (async () => {
      try {
        const config = await bridge.call("desktop:auth-config", { sessionGeneration: SESSION_GENERATION });
        if (!isAuthConfig(config)) throw new Error("invalid auth config");
        controllerRef.current = createLoginController(bridge, SESSION_GENERATION, config.clientId, config.deploymentId);
        const session = await bridge.call("desktop:auth-session", { sessionGeneration: SESSION_GENERATION });
        if (!isSessionMetadata(session)) throw new Error("invalid session metadata");
        setMetadata(session);
        metadataRef.current = session;
        setState(loginStateFromMetadata(session));
      } catch {
        setState("error");
      }
    })();
    return () => { unsubscribe(); unsubscribeLaunch?.(); };
  }, [bridge]);

  if (state === "signed-in" && metadata?.status === "signed-in" && metadata.accountId && metadata.deploymentId) {
    return (
      <SignedIn
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
        setState("pending");
        void controllerRef.current?.start().then(setState);
      }}
      onCancel={() => {
        void controllerRef.current?.cancel().then(setState).catch(() => setState("error"));
      }}
    />
  );
}
