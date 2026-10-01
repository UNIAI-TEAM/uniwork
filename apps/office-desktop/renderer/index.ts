import { renderDesktopShell } from "./shell";
import { createLoginController, loginStateFromMetadata, renderLoginScreen, type LoginScreenState } from "./login";
import { desktopAuthConfigResponseSchema, desktopSessionMetadataSchema, type DesktopIpcChannel, type DesktopIpcRequest, type DesktopLibraryContextResponse, type DesktopSessionMetadata } from "../shared/ipc";
import { createLibraryController, createLibraryScopeController, type LibraryMode } from "./library/model";
import { renderLibrary } from "./library/view";

const SESSION_GENERATION = "desktop-dev-session";

type RendererButton = {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: "click", listener: () => void): void;
  appendChild?: (child: RendererButton) => unknown;
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
  onLaunchRequested?(listener: (event: { documentId: string; operation: "view" | "edit"; version?: number }) => void): () => void;
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

function renderSignedIn(root: RendererRoot, documentLike: RendererDocument, metadata: SignedInMetadata, onLogout: () => void, bridge: RendererBridge): void {
  renderDesktopShell(root, {
    session: metadata,
    registry: createShellButtonRegistry(documentLike, root, onLogout),
  });
  // The account session may not have a workspace selected yet. Keep the shell
  // visible and render the library as soon as the host supplies one; never
  // guess a workspace or issue a cross-scope request.
  const workspaceId = (metadata as SignedInMetadata & { workspaceId?: string }).workspaceId;
  const organizationId = (metadata as SignedInMetadata & { organizationId?: string }).organizationId;
  if ((!workspaceId || !organizationId) && documentLike.createElement && root.appendChild) {
    const picker = documentLike.createElement("section");
    if (!picker.appendChild) return;
    picker.textContent = "Choose a deployment, account, organization, and workspace";
    picker.setAttribute("data-desktop-library-picker", "true");
    root.appendChild(picker);
    void bridge.call("desktop:library-context", { sessionGeneration: SESSION_GENERATION }).then((raw) => {
      const context = raw as DesktopLibraryContextResponse;
      const append = picker.appendChild;
      const createElement = documentLike.createElement;
      if (!append || !createElement) return;
      const selected: Partial<Record<keyof DesktopLibraryContextResponse, string>> = {};
      const redrawPicker = () => {
        picker.textContent = "Choose a deployment, account, organization, and workspace";
        (Object.keys(selected) as Array<keyof DesktopLibraryContextResponse>).forEach((key) => {
          if (selected[key]) picker.textContent += ` ${key}: ${selected[key]}`;
        });
        const groups: Array<keyof DesktopLibraryContextResponse> = ["deployments", "accounts", "organizations", "workspaces"];
        for (const group of groups) {
          const heading = createElement("p");
          heading.textContent = group;
          append.call(picker, heading);
          for (const entry of context[group] ?? []) {
            const option = createElement("button");
            option.textContent = entry.name;
            option.setAttribute("type", "button");
            option.setAttribute("data-picker-kind", group);
            option.setAttribute("data-picker-id", entry.id);
            option.addEventListener("click", () => { selected[group] = entry.id; redrawPicker(); });
            append.call(picker, option);
          }
        }
        const ready = groups.every((group) => Boolean(selected[group]));
        if (!ready) return;
        const choose = createElement("button");
        choose.textContent = "Open documents";
        choose.setAttribute("type", "button");
        choose.addEventListener("click", () => renderSignedIn(root, documentLike, { ...metadata, deploymentId: selected.deployments!, accountId: selected.accounts!, organizationId: selected.organizations!, workspaceId: selected.workspaces! }, onLogout, bridge));
        append.call(picker, choose);
      };
      redrawPicker();
    }).catch(() => undefined);
    return;
  }
  if (!workspaceId || !organizationId || !documentLike.createElement || !root.appendChild) return;
  const libraryRoot = documentLike.createElement("section");
  if (!libraryRoot.appendChild) return;
  root.appendChild(libraryRoot);
  const scopes = createLibraryScopeController({ deploymentId: metadata.deploymentId, accountId: metadata.accountId, organizationId, workspaceId, sessionGeneration: SESSION_GENERATION });
  const controller = createLibraryController(bridge, scopes);
  let mode: LibraryMode = "list";
  let searchQuery = "";
  const drawLibrary = async (): Promise<void> => {
    try {
      const result = mode === "list" ? await controller.list() : mode === "recent" ? await controller.recent() : searchQuery.trim() ? await controller.search(searchQuery.trim()) : { documents: [], nextCursor: null, engineAvailable: true, generation: scopes.getGeneration() };
      renderLibrary(libraryRoot as never, documentLike as never, {
        mode,
        documents: result.documents,
        engineAvailable: result.engineAvailable,
        onModeChange: (next) => { mode = next; void drawLibrary(); },
        onSearch: (query) => { searchQuery = query; if (query.trim()) void drawLibrary(); },
        onOpen: (document) => { void bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId, documentId: document.id, version: document.version }); },
        onDownload: (document) => { void bridge.call("desktop:library-download", { sessionGeneration: SESSION_GENERATION, workspaceId, documentId: document.id, version: document.version }); },
      });
    } catch {
      renderLibrary(libraryRoot as never, documentLike as never, { mode, documents: [], engineAvailable: false, onModeChange: (next) => { mode = next; void drawLibrary(); } });
    }
  };
  void drawLibrary();
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
      }, bridge);
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
  const unsubscribeLaunch = bridge.onLaunchRequested?.((event) => {
    const metadata = currentMetadata;
    const workspaceId = metadata?.status === "signed-in" ? (metadata as DesktopSessionMetadata & { workspaceId?: string }).workspaceId : undefined;
    if (!workspaceId) return;
    void bridge.call("desktop:office-open", { sessionGeneration: SESSION_GENERATION, workspaceId, documentId: event.documentId, ...(event.version === undefined ? {} : { version: event.version }) });
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
  void unsubscribeLaunch;
}

function isSessionMetadata(value: unknown): value is DesktopSessionMetadata {
  return desktopSessionMetadataSchema.safeParse(value).success;
}

function isAuthConfig(value: unknown): value is { clientId: string; deploymentId: string } {
  return desktopAuthConfigResponseSchema.safeParse(value).success;
}

if (typeof document !== "undefined") void mountDesktopRenderer(document as unknown as RendererDocument);
