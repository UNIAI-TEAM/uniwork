// Access token sống trong memory (không localStorage — XSS-safe);
// refresh token là cookie httpOnly do server quản lý.
type Listener = () => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(t: string | null) {
  accessToken = t;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
