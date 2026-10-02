import type { DeviceBinding, ExchangeOutcome, ExchangePort, LaunchOperation, OfficeLaunchDescriptor } from "./exchange";
import { launchUrlFromArgv, parseOfficeDeepLink, type DeepLinkRejectReason } from "./parser";
import { DESKTOP_IDENTITY, DESKTOP_IDENTITY_MANIFEST } from "../../shared/identity";

type LaunchBridgeRefusal =
  | DeepLinkRejectReason
  | "signed_out"
  | "deployment_mismatch"
  | "account_mismatch"
  | "expired"
  | "replayed"
  | "not_found"
  | "forbidden"
  | "device_revoked"
  | "exchange_failed"
  | "duplicate_delivery";

type LaunchBridgeOutcome =
  | Readonly<{ status: "opened"; documentId: string; operation: LaunchOperation; descriptor: OfficeLaunchDescriptor; receiptId: string; redeemedAt: string }>
  | Readonly<{ status: "login_required"; reason: "signed_out" | "deployment_mismatch" | "account_mismatch" }>
  | Readonly<{ status: "refused"; reason: LaunchBridgeRefusal }>;

type LaunchRequestedEvent = Readonly<{ documentId: string; operation: LaunchOperation; version?: number }>;

export type LaunchBridgeOptions = Readonly<{
  exchange: ExchangePort;
  clientId?: string;
  trustedDeploymentId: string;
  getSession: () => DeviceBinding | undefined;
  onLoginRequired?: (reason: "signed_out" | "deployment_mismatch" | "account_mismatch") => void;
}>;

export type LaunchBridge = Readonly<{
  handleUrl(url: string): Promise<LaunchBridgeOutcome>;
  handleColdStart(argv: readonly unknown[]): Promise<LaunchBridgeOutcome | undefined>;
  handleSecondInstance(argv: readonly unknown[]): Promise<LaunchBridgeOutcome | undefined>;
  handleOpenUrl(url: string): Promise<LaunchBridgeOutcome>;
  subscribe(listener: (event: LaunchRequestedEvent) => void): () => void;
}>;

/** One bridge instance owns both cold and warm input. The in-flight and
 * terminal sets prevent argv/open-url duplicate delivery from redeeming twice,
 * while account mismatch remains retryable after a deliberate login. */
export function createLaunchBridge(options: LaunchBridgeOptions): LaunchBridge {
  const clientId = options.clientId ?? DESKTOP_IDENTITY.executable;
  const terminalTickets = new Set<string>();
  const inFlightTickets = new Set<string>();
  const listeners = new Set<(event: LaunchRequestedEvent) => void>();

  const handleUrl = async (url: string): Promise<LaunchBridgeOutcome> => {
    const parsed = parseOfficeDeepLink(url);
    if (!parsed.ok) return { status: "refused", reason: parsed.reason };
    const { ticket } = parsed;
    if (terminalTickets.has(ticket)) return { status: "refused", reason: "replayed" };
    if (inFlightTickets.has(ticket)) return { status: "refused", reason: "duplicate_delivery" };

    const session = options.getSession();
    if (!session) {
      options.onLoginRequired?.("signed_out");
      return { status: "login_required", reason: "signed_out" };
    }
    if (session.deploymentId !== options.trustedDeploymentId) {
      options.onLoginRequired?.("deployment_mismatch");
      return { status: "login_required", reason: "deployment_mismatch" };
    }

    inFlightTickets.add(ticket);
    let result: ExchangeOutcome;
    try {
      result = await options.exchange.exchange({
        launchTicket: ticket,
        clientId,
        deploymentId: session.deploymentId,
        deviceSessionId: session.deviceSessionId,
        accountId: session.accountId,
      });
    } catch {
      terminalTickets.add(ticket);
      inFlightTickets.delete(ticket);
      return { status: "refused", reason: "exchange_failed" };
    }
    inFlightTickets.delete(ticket);

    if (result.kind === "login_required") {
      options.onLoginRequired?.(result.reason);
      return { status: "login_required", reason: result.reason };
    }
    terminalTickets.add(ticket);
    if (result.kind === "refused") return { status: "refused", reason: result.reason };
    const opened: LaunchBridgeOutcome = {
      status: "opened",
      documentId: result.descriptor.id,
      operation: result.descriptor.operation,
      descriptor: result.descriptor,
      receiptId: result.receiptId,
      redeemedAt: result.redeemedAt,
    };
    for (const listener of listeners) {
      try {
      listener({ documentId: opened.documentId, operation: opened.operation, ...(opened.descriptor.version > 0 ? { version: opened.descriptor.version } : {}) });
      } catch {
        // A renderer subscription cannot change the already-redeemed outcome
        // or make a second exchange necessary.
      }
    }
    return opened;
  };

  return {
    handleUrl,
    async handleColdStart(argv) {
      const url = launchUrlFromArgv(argv);
      return url === undefined ? undefined : handleUrl(url);
    },
    async handleSecondInstance(argv) {
      const url = launchUrlFromArgv(argv);
      return url === undefined ? undefined : handleUrl(url);
    },
    handleOpenUrl: handleUrl,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type DeepLinkSystem = Readonly<{
  requestSingleInstanceLock(): boolean;
  registerProtocolClient(scheme: string): void;
  /** Electron supplies (event, commandLine, workingDirectory); tests may
   * provide the argv as the first argument for the adapter seam. */
  onSecondInstance(listener: (eventOrArgv: unknown, argv?: readonly unknown[]) => void): void;
  onOpenUrl(listener: (event: { preventDefault(): void }, url: string) => void): void;
  /** macOS only: URLs that arrived before the handler was attached (cold-start
   * open-url), drained once so no delivery is processed twice. */
  takePendingOpenUrls?(): readonly string[];
  quit?(): void;
}>;

export type DeepLinkRegistration = Readonly<{ primary: boolean; dispose(): void }>;

function authCallbackFromArgv(argv: readonly unknown[]): string | undefined {
  const callbacks = Object.values(DESKTOP_IDENTITY_MANIFEST.channelProfiles).map((profile) => profile.authCallback);
  return argv.find((value): value is string => typeof value === "string" && callbacks.some((callback) => value.startsWith(callback)));
}

/** Register the protocol only in the process that owns the lock. Electron's
 * second-instance and open-url callbacks feed the same bridge object as cold
 * argv, so there is one parser/exchange namespace. */
export function registerDeepLinkSystem(system: DeepLinkSystem, bridge: LaunchBridge, authCallback?: (url: string) => Promise<unknown> | unknown): DeepLinkRegistration {
  if (!system.requestSingleInstanceLock()) {
    system.quit?.();
    return { primary: false, dispose: () => undefined };
  }
  system.registerProtocolClient(DESKTOP_IDENTITY.userScheme);
  const second = (eventOrArgv: unknown, maybeArgv?: readonly unknown[]) => {
    const argv = Array.isArray(maybeArgv) ? maybeArgv : Array.isArray(eventOrArgv) ? eventOrArgv : [];
    const authUrl = authCallbackFromArgv(argv);
    if (authCallback && authUrl) {
      void authCallback(authUrl);
      return;
    }
    void bridge.handleSecondInstance(argv);
  };
  const routeUrl = (url: string) => {
    const isAuthCallback = Object.values(DESKTOP_IDENTITY_MANIFEST.channelProfiles).some((profile) => url.startsWith(profile.authCallback));
    if (authCallback && isAuthCallback) {
      void authCallback(url);
      return;
    }
    void bridge.handleOpenUrl(url);
  };
  const open = (event: { preventDefault(): void }, url: string) => {
    event.preventDefault();
    routeUrl(url);
  };
  system.onSecondInstance(second);
  system.onOpenUrl(open);
  for (const url of system.takePendingOpenUrls?.() ?? []) routeUrl(url);
  return { primary: true, dispose: () => undefined };
}
