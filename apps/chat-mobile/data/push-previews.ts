// Whether this person's chat pushes show the message's words (Settings ›
// Privacy & security). The
// choice is the server's (users.push_previews_hidden_at, read through /me),
// mirrored into the signed-in user like the AI consent (data/ai-consent.ts): a
// drifted 2xx still recorded it, so the user is updated locally instead.
import { accountApi } from "./account-api";
import { useAuthStore } from "./auth/store";

export async function setPushPreviews(show: boolean): Promise<void> {
  const next = await accountApi.setPushPreviews(show);
  const { user, setUser } = useAuthStore.getState();
  if (next) setUser(next);
  else if (user) setUser({ ...user, push_previews: show });
}
