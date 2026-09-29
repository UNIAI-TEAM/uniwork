import type { DesktopIpcChannel, DesktopIpcRequest, DesktopSessionMetadata } from "../shared/ipc";

export type LoginScreenState = "signed-out" | "pending" | "error" | "cancelled" | "signed-in";
type LoginTextKey = "login.title" | "login.signedOut" | "login.pending" | "login.error" | "login.cancelled" | "login.signedIn" | "login.start" | "login.cancel";
type LoginText = (key: LoginTextKey) => string;
type LoginPrimitiveRegistry = Readonly<{ button?: (props: Readonly<{ label: string; action: "start" | "cancel" }>) => unknown }>;
export type LoginRenderAdapter = Readonly<{ t?: LoginText; registry?: LoginPrimitiveRegistry }>;
export type LoginRoot = { textContent: string | null; setAttribute(name: string, value: string): void };

const defaultText: Record<LoginTextKey, string> = {
  "login.title": "Sign in to UniWork Office",
  "login.signedOut": "Sign in securely in your system browser.",
  "login.pending": "Continue in the system browser to finish sign in.",
  "login.error": "Sign in could not be completed. Try again.",
  "login.cancelled": "Sign in was cancelled.",
  "login.signedIn": "You are signed in.",
  "login.start": "Start login",
  "login.cancel": "Cancel login",
};

export function loginStateFromMetadata(metadata: DesktopSessionMetadata): LoginScreenState {
  return metadata.status;
}

export function renderLoginScreen(root: LoginRoot, state: LoginScreenState, adapter: LoginRenderAdapter = {}): void {
  const t = adapter.t ?? ((key: LoginTextKey) => defaultText[key]);
  const messageKey: LoginTextKey = state === "signed-out" ? "login.signedOut" : state === "pending" ? "login.pending" : state === "error" ? "login.error" : state === "cancelled" ? "login.cancelled" : "login.signedIn";
  const actionKey: LoginTextKey = state === "pending" ? "login.cancel" : "login.start";
  root.textContent = `${t("login.title")}\n${t(messageKey)}\n${t(actionKey)}`;
  root.setAttribute("data-login-state", state);
  adapter.registry?.button?.({ label: t(actionKey), action: state === "pending" ? "cancel" : "start" });
}

/** Controller used by the renderer adapter. It carries only opaque command
 * data and session metadata; no credential-shaped response is accepted. */
type RendererBridge = { call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown> };

export function createLoginController(bridge: Pick<RendererBridge, "call">, sessionGeneration: string, clientId: string, deploymentId: string) {
  let state: LoginScreenState = "signed-out";
  let attemptId: string | undefined;
  return {
    getState: () => state,
    async start(): Promise<LoginScreenState> {
      state = "pending";
      try {
        const result = await bridge.call("desktop:auth-start", { sessionGeneration, clientId, deploymentId });
        const pending = result as { status?: unknown; attemptId?: unknown };
        if (pending.status !== "pending" || typeof pending.attemptId !== "string") throw new Error("invalid login response");
        attemptId = pending.attemptId;
      } catch {
        state = "error";
      }
      return state;
    },
    async cancel(): Promise<LoginScreenState> {
      if (!attemptId) { state = "cancelled"; return state; }
      await bridge.call("desktop:auth-cancel", { sessionGeneration, attemptId });
      attemptId = undefined;
      state = "cancelled";
      return state;
    },
  };
}
