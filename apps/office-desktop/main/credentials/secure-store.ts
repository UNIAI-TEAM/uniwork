/** OS credential store seam owned by the desktop host.  The implementation is
 * kept in auth/credentials.ts for compatibility with the 03a port; this module
 * is the 03b production entry used by Electron bootstrap and future callers. */
export {
  createSecureCredentialStore,
} from "../auth/credentials";
