import type { DesktopIpcChannel, DesktopIpcRequest, DesktopSessionMetadata } from "../shared/ipc";

export type LoginScreenState = "signed-out" | "pending" | "error" | "cancelled" | "signed-in" | "locked" | "login-required";

export function loginStateFromMetadata(metadata: DesktopSessionMetadata): LoginScreenState {
  return metadata.status;
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
