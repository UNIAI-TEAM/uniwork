export type CredentialSession = Readonly<{
  accountId: string;
  deviceSessionId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}>;

/** Port owned by main. 03a only supplies an in-memory fake; OS-backed stores
 * are deliberately deferred to 03b (G4-D2 library choice remains open). */
export type CredentialStore = Readonly<{
  save(session: CredentialSession): Promise<void> | void;
  get(): Promise<CredentialSession | undefined> | CredentialSession | undefined;
  clear(): Promise<void> | void;
}>;

export function createInMemoryCredentialStore(): CredentialStore {
  let current: CredentialSession | undefined;
  return Object.freeze({
    save(session) { current = Object.freeze({ ...session }); },
    get() { return current; },
    clear() { current = undefined; },
  });
}

