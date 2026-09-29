export type DesktopStartRequest = Readonly<{
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
  redirectUri: string;
  deploymentId: string;
}>;

export type DesktopStartResponse = Readonly<{ authorizationUrl: string; attemptExpiresAt: string }>;

export type DesktopExchangeRequest = Readonly<{
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  deploymentId: string;
}>;

export type DesktopSessionResponse = Readonly<{
  accountId: string;
  deviceSessionId: string;
  sessionId: string;
  deploymentId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}>;

export type AuthTransport = Readonly<{
  start(request: DesktopStartRequest): Promise<DesktopStartResponse>;
  exchange(request: DesktopExchangeRequest): Promise<DesktopSessionResponse>;
}>;

export type AuthServerContract = Readonly<{
  start(request: DesktopStartRequest): Promise<DesktopStartResponse>;
  exchange(request: DesktopExchangeRequest): Promise<DesktopSessionResponse>;
}>;

export type HostTransportOptions = Readonly<{
  origin: string;
  clientId: string;
  deploymentId: string;
  server: AuthServerContract;
}>;

/**
 * Main-process transport seam. The only registered paths/methods are the two
 * 02a auth operations; there is no generic URL proxy and no renderer access to
 * this object. The real TLS client replaces the fake server in 03b.
 */
export function createAllowlistedAuthTransport(options: HostTransportOptions): AuthTransport {
  const origin = new URL(options.origin);
  const loopback = origin.hostname === "localhost" || origin.hostname === "127.0.0.1" || origin.hostname === "[::1]";
  if (origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) throw new Error("Auth transport origin must use HTTPS or a loopback test origin");
  if (!options.clientId || !options.deploymentId) throw new Error("Auth transport binding is incomplete");
  const dispatch = async <T>(method: string, path: string, request: DesktopStartRequest | DesktopExchangeRequest): Promise<T> => {
    if (method === "GET" && path === "/auth/desktop/start") return options.server.start(request as DesktopStartRequest) as Promise<T>;
    if (method === "POST" && path === "/auth/desktop/exchange") return options.server.exchange(request as DesktopExchangeRequest) as Promise<T>;
    throw new Error("Auth transport endpoint is not allowlisted");
  };
  return Object.freeze({
    start(request) {
      assertBinding(request.clientId, request.deploymentId, options);
      return dispatch<DesktopStartResponse>("GET", "/auth/desktop/start", request);
    },
    exchange(request) {
      assertBinding(request.clientId, request.deploymentId, options);
      return dispatch<DesktopSessionResponse>("POST", "/auth/desktop/exchange", request);
    },
  });
}

function assertBinding(clientId: string, deploymentId: string, options: HostTransportOptions): void {
  if (clientId !== options.clientId || deploymentId !== options.deploymentId) throw new Error("Auth transport session binding mismatch");
}
