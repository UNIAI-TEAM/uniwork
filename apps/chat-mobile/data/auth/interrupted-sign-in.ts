// A choice screen the app was closed in the middle of (spec §5.2): the ticket and its nonce live in memory only
// (pending-sign-in.ts), so a kill takes them, and the next open says the Apple or Google sign-in ran out instead of
// opening on a blank sign-in screen as if nothing had happened. All this keeps on the device is which provider and
// when: no ticket, no nonce, no address. Written when a choice is held, removed when it is spent, declined or
// replaced and once someone is signed in, read once at boot.
import { isSignInProvider, type SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { openDeviceStore } from "../storage/device-store";

const KEY = "sign-in/choice-open";

/** Past this, a sign-in left open is too old to mention: the person has moved on. */
export const INTERRUPTED_NOTICE_MS = 60 * 60_000;

export async function markChoiceOpen(provider: SignInProvider, now: number): Promise<void> {
  (await openDeviceStore()).set(KEY, JSON.stringify({ provider, at: now }));
}

export async function clearChoiceMark(): Promise<void> {
  (await openDeviceStore()).remove(KEY);
}

/** The provider of a choice the last run left open, when recent enough to say so; the mark is gone either way. */
export async function takeInterruptedChoice(now: number): Promise<SignInProvider | null> {
  const store = await openDeviceStore();
  const raw = store.getString(KEY);
  if (raw === undefined) return null;
  store.remove(KEY);
  let mark: unknown;
  try {
    mark = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof mark !== "object" || mark === null) return null;
  const provider: unknown = Reflect.get(mark, "provider");
  const at: unknown = Reflect.get(mark, "at");
  if (!isSignInProvider(provider) || typeof at !== "number" || now - at > INTERRUPTED_NOTICE_MS || at > now) return null;
  return provider;
}
