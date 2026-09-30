import { renderDesktopRecoveryState, renderDesktopShell, type DesktopRecoveryState } from "./shell";
import { createLoginController, loginStateFromMetadata, renderLoginScreen, type LoginScreenState } from "./login";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema, type DesktopIpcChannel, type DesktopIpcRequest, type DesktopSessionMetadata } from "../shared/ipc";

const SESSION_GENERATION = "desktop-dev-session";

type RendererButton = {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "click", listener: () => void): void;
};
type RendererRoot = {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild?: (child: RendererButton) => unknown;
};
type RendererDocument = {
  getElementById(id: string): RendererRoot | null;
  createElement?: (tagName: string) => RendererButton;
};
type RendererBridge = {
  call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown>;
  onSessionChanged(listener: (metadata: DesktopSessionMetadata) => void): () => void;
  /** Optional host-provided locale adapter; the shell has safe English copy. */
  t?: (key: string) => string;
};

declare global {
  interface Window { uniworkOffice?: RendererBridge; }
}

function createDomButton(documentLike: RendererDocument, root: RendererRoot, label: string, action: "start" | "cancel" | "logout", onAction: () => void): void {
  const button = documentLike.createElement!("button");
  button.textContent = label;
  button.setAttribute("type", "button");
  button.setAttribute("data-login-action", action);
  button.addEventListener("click", onAction);
  root.appendChild!(button);
}

function createLoginButtonRegistry(documentLike: RendererDocument, root: RendererRoot, onAction: (action: "start" | "cancel") => void) {
  if (!documentLike.createElement || !root.appendChild) return undefined;
  return {
    button: ({ label, action }: { label: string; action: "start" | "cancel" }) => createDomButton(documentLike, root, label, action, () => onAction(action)),
  };
}

function createShellButtonRegistry(documentLike: RendererDocument, root: RendererRoot, onLogout: () => void) {
  if (!documentLike.createElement || !root.appendChild) return undefined;
  return {
    button: ({ label }: { label: string; action: "logout" }) => createDomButton(documentLike, root, label, "logout", onLogout),
  };
}

function renderLogin(root: RendererRoot, documentLike: RendererDocument, state: LoginScreenState, onAction: (action: "start" | "cancel") => void): void {
  renderLoginScreen(root, state, { registry: createLoginButtonRegistry(documentLike, root, onAction) });
}

type SignedInMetadata = DesktopSessionMetadata & { status: "signed-in"; accountId: string; deploymentId: string };

function renderSignedIn(root: RendererRoot, documentLike: RendererDocument, metadata: SignedInMetadata, onLogout: () => void, recovery?: DesktopRecoveryState, t?: (key: string) => string): void {
  renderDesktopShell(root, {
    session: metadata,
    t,
    registry: createShellButtonRegistry(documentLike, root, onLogout),
  });
  const recoveryElement = documentLike.createElement?.("div");
  if (recoveryElement && root.appendChild) {
    recoveryElement.setAttribute("data-recovery-host", "true");
    root.appendChild(recoveryElement);
    renderDesktopRecoveryState(recoveryElement, recovery ?? "none", t);
  } else {
    // Minimal test/host adapters without child creation still receive a
    // deterministic state, while real DOM hosts preserve shell controls.
    renderDesktopRecoveryState(root, recovery ?? "none", t);
  }
}

export async function mountDesktopRenderer(documentLike: RendererDocument, bridge: RendererBridge | undefined = typeof window !== "undefined" ? window.uniworkOffice : undefined): Promise<void> {
  const root = documentLike.getElementById("root");
  if (!root) return;
  if (!bridge) {
    renderLogin(root, documentLike, "error", () => undefined);
    return;
  }

  let controller: ReturnType<typeof createLoginController> | undefined;
  let currentMetadata: DesktopSessionMetadata | undefined;
  const renderState = (state: LoginScreenState): void => {
    const metadata = currentMetadata;
    if (state === "signed-in" && metadata?.status === "signed-in") {
      renderSignedIn(root, documentLike, metadata as SignedInMetadata, () => {
        void bridge.call("desktop:auth-logout", { sessionGeneration: SESSION_GENERATION, scope: "device" }).then((metadata) => {
          if (isSessionMetadata(metadata)) { currentMetadata = metadata; renderState(loginStateFromMetadata(metadata)); }
        }).catch(() => renderState("error"));
      }, undefined, bridge.t);
      return;
    }
    renderLogin(root, documentLike, state, (action) => {
      if (!controller) return;
      if (action === "start") {
        renderState("pending");
        void controller.start().then(renderState);
      } else {
        void controller.cancel().then(renderState).catch(() => renderState("error"));
      }
    });
  };

  const unsubscribe = bridge.onSessionChanged((metadata) => {
    currentMetadata = metadata;
    renderState(loginStateFromMetadata(metadata));
  });
  try {
    const config = await bridge.call("desktop:auth-config", { sessionGeneration: SESSION_GENERATION });
    if (!isAuthConfig(config)) throw new Error("invalid auth config");
    controller = createLoginController(bridge, SESSION_GENERATION, config.clientId, config.deploymentId);
    const metadata = await bridge.call("desktop:auth-session", { sessionGeneration: SESSION_GENERATION });
    if (!isSessionMetadata(metadata)) throw new Error("invalid session metadata");
    currentMetadata = metadata;
    renderState(loginStateFromMetadata(metadata));
  } catch {
    renderState("error");
  }
  void unsubscribe;
}

function isSessionMetadata(value: unknown): value is DesktopSessionMetadata {
  return desktopSessionMetadataSchema.safeParse(value).success;
}

function isAuthConfig(value: unknown): value is { clientId: string; deploymentId: string } {
  return desktopAuthConfigResponseSchema.safeParse(value).success;
}

if (typeof document !== "undefined") void mountDesktopRenderer(document as unknown as RendererDocument);
