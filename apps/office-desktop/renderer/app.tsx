import { useEffect, useRef, useState } from "react";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema, localStateResponseSchema } from "../shared/ipc";
import type { DesktopIpcChannel, DesktopIpcRequest, DesktopSessionMetadata } from "../shared/ipc";
import { createLoginController, loginStateFromMetadata, type LoginScreenState } from "./login";
import { DesktopWorkspace, type SignedInMetadata } from "./desktop-workspace";

const SESSION_GENERATION = "desktop-dev-session";
export type RendererBridge = Readonly<{
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  onSessionChanged(listener: (metadata: DesktopSessionMetadata) => void): () => void;
  onLaunchRequested?(listener: (event: { documentId: string; operation: "view" | "edit"; version?: number }) => void): () => void;
  onOfficeSaveRequested?(listener: (event: { documentId: string }) => void): () => void;
  onLeaveRequested?(listener: (event: { requestId: string; reason: "close" | "logout" | "update" }) => void): () => void;
  openDroppedFile?(file: File): Promise<unknown>;
  onFileOpenRequested?(listener: (event: { handle: string }) => void): () => void;
  onLoginRequested?(listener: (event: { reason: "signed_out" | "deployment_mismatch" | "account_mismatch" }) => void): () => void;
}>;
function isSessionMetadata(value: unknown): value is DesktopSessionMetadata { return desktopSessionMetadataSchema.safeParse(value).success; }
function isAuthConfig(value: unknown): value is { clientId: string; deploymentId: string } { return desktopAuthConfigResponseSchema.safeParse(value).success; }
function requestedLocalState(value: unknown): boolean { const parsed = localStateResponseSchema.safeParse(value); return parsed.success && parsed.data.localMode; }

/** Top-level renderer app. The host reports a session and a per-device mode
 * preference; signed out with the local mode chosen the workspace renders the
 * local home, otherwise the sign-in card. Both modes share one mounted
 * workspace so local tabs survive signing in and out. */
export function App({ bridge }: { bridge: RendererBridge }) {
  const [state, setState] = useState<LoginScreenState>("signed-out");
  const [metadata, setMetadata] = useState<DesktopSessionMetadata | undefined>(undefined);
  const [localMode, setLocalMode] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(false);
  const [openLocalRequest, setOpenLocalRequest] = useState(0);
  const [booted, setBooted] = useState(false);
  const controllerRef = useRef<ReturnType<typeof createLoginController> | undefined>(undefined);
  const metadataRef = useRef<DesktopSessionMetadata | undefined>(undefined);

  useEffect(() => {
    let unsubscribeController: (() => void) | undefined;
    const unsubscribe = bridge.onSessionChanged((next) => {
      controllerRef.current?.clearExpiry();
      const previous = metadataRef.current;
      metadataRef.current = next;
      setMetadata(next);
      setState(loginStateFromMetadata(next));
      // A sign-out returns to the local home; the next launch has no session
      // and reads the persisted choice instead.
      if (next.status === "signed-out" && previous?.status === "signed-in") {
        setLocalMode(true);
        setLoginPrompt(false);
        void bridge.call("desktop:local-mode", { sessionGeneration: SESSION_GENERATION, local: true }).catch(() => undefined);
      }
    });
    const unsubscribeLogin = bridge.onLoginRequested?.(() => {
      if (metadataRef.current?.status === "signed-in") return;
      setState("login-required");
      setLoginPrompt(true);
    });
    void (async () => {
      // Local mode must not depend on the auth surface: a device with the
      // local preference and no deployment profile opens the local home even
      // when auth-config cannot be resolved.
      const [config, session, local] = await Promise.allSettled([
        bridge.call("desktop:auth-config", { sessionGeneration: SESSION_GENERATION }),
        bridge.call("desktop:auth-session", { sessionGeneration: SESSION_GENERATION }),
        bridge.call("desktop:local-state", { sessionGeneration: SESSION_GENERATION }),
      ]);
      setLocalMode(local.status === "fulfilled" ? requestedLocalState(local.value) : false);
      if (config.status === "fulfilled" && isAuthConfig(config.value)) {
        controllerRef.current = createLoginController(bridge, SESSION_GENERATION, config.value.clientId, config.value.deploymentId);
        unsubscribeController = controllerRef.current.subscribe(setState);
        if (session.status === "fulfilled" && isSessionMetadata(session.value)) {
          metadataRef.current = session.value;
          setMetadata(session.value);
          setState(loginStateFromMetadata(session.value));
          setBooted(true);
          return;
        }
      }
      setState("error");
      setBooted(true);
    })();
    return () => { unsubscribe(); unsubscribeLogin?.(); unsubscribeController?.(); };
  }, [bridge]);

  const useLocal = (entry: "home" | "open-local") => {
    setLocalMode(true);
    setLoginPrompt(false);
    if (entry === "open-local") setOpenLocalRequest((value) => value + 1);
    void bridge.call("desktop:local-mode", { sessionGeneration: SESSION_GENERATION, local: true }).catch(() => undefined);
  };
  const signedIn = state === "signed-in" && metadata?.status === "signed-in" && Boolean(metadata.accountId) && Boolean(metadata.deploymentId);
  const mode = signedIn ? "signed-in" : localMode && !loginPrompt ? "local" : "login";
  // No card before the init triplet settles: a remembered-local device must
  // not flash the sign-in card before the local home.
  if (!booted) return null;
  return (
    <DesktopWorkspace
      bridge={bridge}
      mode={mode}
      metadata={signedIn ? (metadata as SignedInMetadata) : undefined}
      loginState={state}
      onLoginStart={() => {
        // Without a resolved auth binding the flow cannot start: surface the
        // error state instead of a silent no-op.
        if (!controllerRef.current) { setState("error"); return; }
        setState("pending");
        void controllerRef.current.start().then(setState);
      }}
      onLoginCancel={() => { void controllerRef.current?.cancel().then(setState).catch(() => setState("error")); }}
      onUseLocal={useLocal}
      onSignIn={() => { setState("login-required"); setLoginPrompt(true); }}
      onLogout={async () => {
        const next = await bridge.call("desktop:auth-logout", { sessionGeneration: SESSION_GENERATION, scope: "device" });
        if (isSessionMetadata(next)) {
          metadataRef.current = next;
          setMetadata(next);
          setState(loginStateFromMetadata(next));
          if (next.status !== "signed-in") { setLocalMode(true); setLoginPrompt(false); void bridge.call("desktop:local-mode", { sessionGeneration: SESSION_GENERATION, local: true }).catch(() => undefined); }
        }
      }}
      openLocalRequest={openLocalRequest}
    />
  );
}
