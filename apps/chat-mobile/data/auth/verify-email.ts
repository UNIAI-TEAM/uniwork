// Proving the account's address with the six-digit code mailed at sign-up (spec §5.2): until it is proved the app
// shows no workspace (app/index.tsx, select-workspace.tsx), as the web sends an unverified account to /verify. The
// verified user replaces the signed-in one, so every gate moves on without reloading /me; a drifted 2xx still
// verified the address on the server, so the user is marked verified here instead.
import { accountApi } from "../account-api";
import { useAuthStore } from "./store";

export async function verifyAccountEmail(code: string, now: () => Date = () => new Date()): Promise<void> {
  const verified = await accountApi.verifyEmail(code);
  const { user, setUser } = useAuthStore.getState();
  if (verified) setUser(verified);
  else if (user) setUser({ ...user, email_verified_at: now().toISOString() });
}
