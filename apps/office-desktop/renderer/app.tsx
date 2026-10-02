import { useEffect, useRef, useState } from "react";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema } from "../shared/ipc";
import type { DesktopIpcChannel, DesktopIpcRequest, DesktopSessionMetadata } from "../shared/ipc";
import { createLoginController, loginStateFromMetadata, type LoginScreenState } from "./login";
import { LoginScreen } from "./login-screen";
import { SignedInApp, type SignedInMetadata } from "./signed-in-app";
import { DesktopTabStrip } from "./tab-strip";

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
function isSessionMetadata(value: unknown): value is DesktopSessionMetadata { return desktopSessionMetadataSchema.safeParse(value).success; }
function isAuthConfig(value: unknown): value is { clientId: string; deploymentId: string } { return desktopAuthConfigResponseSchema.safeParse(value).success; }

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
      <SignedInApp
        key={`${metadata.deploymentId}:${metadata.accountId}`}
        bridge={bridge}
        metadata={metadata as SignedInMetadata}
        onLogout={async () => {
          await bridge
            .call("desktop:auth-logout", { sessionGeneration: SESSION_GENERATION, scope: "device" })
            .then((next) => {
              if (isSessionMetadata(next)) {
                setMetadata(next);
                setState(loginStateFromMetadata(next));
              }
            });
        }}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
    <DesktopTabStrip signedOut tabs={[]} activeTabId={null} onSelect={() => undefined} onClose={() => undefined} onCreate={() => undefined} onOpenLocal={() => undefined} onSignOut={() => undefined} />
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
    </div>
  );
}
