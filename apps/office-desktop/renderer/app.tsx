import { useEffect, useRef, useState } from "react";
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

const SESSION_GENERATION = "desktop-dev-session";

export type RendererBridge = Readonly<{
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  onSessionChanged(listener: (metadata: DesktopSessionMetadata) => void): () => void;
  onLaunchRequested?(listener: (event: { documentId: string; operation: "view" | "edit"; version?: number }) => void): () => void;
}>;

type SignedInMetadata = DesktopSessionMetadata & { status: "signed-in"; accountId: string; deploymentId: string };
type Scope = SignedInMetadata & { organizationId?: string; workspaceId?: string };

function isSessionMetadata(value: unknown): value is DesktopSessionMetadata {
  return typeof value === "object" && value !== null && "status" in value;
}
function isAuthConfig(value: unknown): value is { clientId: string; deploymentId: string } {
  return typeof value === "object" && value !== null && typeof (value as { clientId?: unknown }).clientId === "string";
}
function isLibraryContext(value: unknown): value is DesktopLibraryContextResponse {
  return typeof value === "object" && value !== null && Array.isArray((value as { deployments?: unknown }).deployments);
}

/** Scope picked plus its workspace library, between sign-in and opening a
 * document. Kept separate from the DOCX host, which mounts once a document
 * is chosen. */
function LibraryHost({ bridge, scope }: { bridge: RendererBridge; scope: Scope & { organizationId: string; workspaceId: string } }) {
  const [mode, setMode] = useState<LibraryMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [result, setResult] = useState<{ documents: DesktopLibraryDocument[]; engineAvailable: boolean } | null>(null);
  const scopeController = useRef(createLibraryScopeController({ deploymentId: scope.deploymentId, accountId: scope.accountId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, sessionGeneration: SESSION_GENERATION }));
  const controller = useRef(createLibraryController(bridge, scopeController.current));
  const drawSequence = useRef(0);

  useEffect(() => {
    let active = true;
    const requestSequence = ++drawSequence.current;
    const run = mode === "list" ? controller.current.list() : mode === "recent" ? controller.current.recent() : searchQuery.trim() ? controller.current.search(searchQuery.trim()) : Promise.resolve({ documents: [], nextCursor: null, engineAvailable: true, generation: 0 });
    void run
      .then((next) => {
        if (!active || requestSequence !== drawSequence.current) return;
        setResult({ documents: next.documents, engineAvailable: next.engineAvailable });
      })
      .catch(() => {
        if (!active || requestSequence !== drawSequence.current) return;
        setResult({ documents: [], engineAvailable: false });
      });
    return () => { active = false; };
  }, [mode, searchQuery]);

  return (
    <LibraryView
      mode={mode}
      searchQuery={searchQuery}
      documents={result?.documents ?? []}
      engineAvailable={result?.engineAvailable ?? true}
      onModeChange={setMode}
      onSearch={setSearchQuery}
      onOpen={(document) => {
        void bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version });
      }}
      onDownload={(document) => {
        void bridge.call("desktop:library-download", { sessionGeneration: SESSION_GENERATION, workspaceId: scope.workspaceId, documentId: document.id, version: document.version });
      }}
    />
  );
}

function SignedIn({ bridge, metadata, onLogout }: { bridge: RendererBridge; metadata: SignedInMetadata; onLogout: () => void }) {
  const [scope, setScope] = useState<LibraryPickerSelection | null>(null);
  const [context, setContext] = useState<DesktopLibraryContextResponse | null>(null);

  useEffect(() => {
    let active = true;
    void bridge.call("desktop:library-context", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      if (active && isLibraryContext(raw)) setContext(raw);
    });
    return () => { active = false; };
  }, [bridge]);

  return (
    <SignedInShell onSignOut={onLogout}>
      {scope ? (
        <LibraryHost bridge={bridge} scope={{ ...metadata, ...scope }} />
      ) : (
        <LibraryPicker context={context} onChoose={setScope} />
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

  useEffect(() => {
    const unsubscribe = bridge.onSessionChanged((next) => {
      setMetadata(next);
      setState(loginStateFromMetadata(next));
    });
    void (async () => {
      try {
        const config = await bridge.call("desktop:auth-config", { sessionGeneration: SESSION_GENERATION });
        if (!isAuthConfig(config)) throw new Error("invalid auth config");
        controllerRef.current = createLoginController(bridge, SESSION_GENERATION, config.clientId, config.deploymentId);
        const session = await bridge.call("desktop:auth-session", { sessionGeneration: SESSION_GENERATION });
        if (!isSessionMetadata(session)) throw new Error("invalid session metadata");
        setMetadata(session);
        setState(loginStateFromMetadata(session));
      } catch {
        setState("error");
      }
    })();
    return unsubscribe;
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
