import type { DesktopIpcChannel, DesktopIpcRequest, DesktopSessionMetadata } from "../shared/ipc";

export type LoginScreenState = "signed-out" | "pending" | "error" | "cancelled" | "signed-in" | "locked" | "login-required" | "expired";

export function loginStateFromMetadata(metadata: DesktopSessionMetadata): LoginScreenState {
  return metadata.status;
}

/** Controller used by the renderer adapter. It carries only opaque command
 * data and session metadata; no credential-shaped response is accepted. */
type RendererBridge = { call<C extends DesktopIpcChannel>(channel: C, payload: DesktopIpcRequest<C>): Promise<unknown> };

export function createLoginController(bridge: Pick<RendererBridge, "call">, sessionGeneration: string, clientId: string, deploymentId: string) {
  let state: LoginScreenState = "signed-out";
  let attemptId: string | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let listener: ((state: LoginScreenState) => void) | undefined;
  const clearExpiry = () => {
    if (expiryTimer !== undefined) {
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
    }
  };
  const push = (next: LoginScreenState) => {
    state = next;
    listener?.(next);
  };
  return {
    getState: () => state,
    subscribe(next: (state: LoginScreenState) => void) {
      listener = next;
      return () => { if (listener === next) listener = undefined; };
    },
    /** A host session change or teardown settles the attempt; its timer is moot. */
    clearExpiry,
    async start(): Promise<LoginScreenState> {
      state = "pending";
      attemptId = undefined;
      clearExpiry();
      try {
        const result = await bridge.call("desktop:auth-start", { sessionGeneration, clientId, deploymentId });
        const pending = result as { status?: unknown; attemptId?: unknown; expiresAt?: unknown };
        if (pending.status !== "pending" || typeof pending.attemptId !== "string") throw new Error("invalid login response");
        attemptId = pending.attemptId;
        if (typeof pending.expiresAt === "number" && Number.isFinite(pending.expiresAt)) {
          const delay = Math.max(0, pending.expiresAt - Date.now());
          expiryTimer = setTimeout(() => {
            expiryTimer = undefined;
            attemptId = undefined;
            push("expired");
          }, delay);
        }
      } catch {
        state = "error";
      }
      return state;
    },
    async cancel(): Promise<LoginScreenState> {
      clearExpiry();
      if (!attemptId) { state = "cancelled"; return state; }
      await bridge.call("desktop:auth-cancel", { sessionGeneration, attemptId });
      attemptId = undefined;
      state = "cancelled";
      return state;
    },
  };
}
