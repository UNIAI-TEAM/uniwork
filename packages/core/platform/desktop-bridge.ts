/**
 * The contract between the web app and the UniChat desktop shell
 * (`apps/chat-desktop`, slice D1). The shell's preload exposes exactly this
 * object as `window.desktopAPI`; the web side reads it only through
 * `getDesktopBridge()`, so web and SSR see `null` and every call site stays a
 * no-op without a host. Every `on*` subscription returns its unsubscribe.
 *
 * Tokens: the shell owns the refresh token and hands the renderer access
 * tokens only (`session`), mirroring the Office shell's main-process session.
 */
export interface SessionProvider {
  /** The current access token, or null when the shell has no session. */
  getAccessToken(): Promise<string | null>;
  /** Rotate and return a fresh access token; null when the session is gone. */
  refresh(): Promise<string | null>;
  logout(): Promise<void>;
  /** Fires with the new token, or null when the session ends. */
  onChange(cb: (token: string | null) => void): () => void;
}

export interface DesktopBridge {
  app: "unichat";
  appInfo: { version: string; os: "macos" | "windows" | "linux" | "unknown" };
  session: SessionProvider;
  setBadgeCount(count: number): void;
  isFocused(): Promise<boolean>;
  onFocusChange(cb: (focused: boolean) => void): () => void;
  focusWindow(): void;
  openExternal(url: string): Promise<void>;
  downloadURL(url: string, name?: string): Promise<void>;
  /** `uniworkchat://open?url=<path>` or an https URL of this app. */
  onDeepLink(cb: (url: string) => void): () => void;
}

/** The UniChat bridge when this page runs inside it; null on web and during SSR. */
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { desktopAPI?: Partial<DesktopBridge> }).desktopAPI;
  return bridge?.app === "unichat" ? (bridge as DesktopBridge) : null;
}
