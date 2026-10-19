// The token readers the workspace layout hands RealtimeProvider. Pure so the
// 4001 recovery policy is tested without expo: the api client may have rotated
// the token seconds before the close, so the current token is tried first and
// a refresh is spent only on the token the socket actually died with. A refresh
// that yields nothing while the session is not signed out is transient
// (dead spot, 5xx) and rejects, so the provider leaves the socket down for the
// next foreground return instead of disconnecting it for the whole session.

export interface SocketSession {
  getAccessToken: () => Promise<string | null>;
  refresh: () => Promise<string | null>;
  status: () => string;
}

export function socketTokenReaders(session: SocketSession) {
  let dialed: string | null = null;
  return {
    getToken: async (): Promise<string | null> => (dialed = await session.getAccessToken()),
    refreshSession: async (): Promise<string | null> => {
      let token = await session.getAccessToken();
      if (token === dialed) token = await session.refresh();
      if (!token && session.status() !== "signed-out") throw new Error("transient refresh failure after 4001");
      return token;
    },
  };
}
