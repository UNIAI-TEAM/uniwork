/**
 * Deep links the shell accepts in D1: `<scheme>://open?url=<percent-encoded
 * in-app path>` (https links are D2, spec §3.4). They enter through the
 * cold-start argv (Windows/Linux), `open-url` (macOS) or a second instance,
 * and wait in `MainRendererQueue` until the renderer has its listener mounted:
 * `did-finish-load` is too early, React effects subscribe later.
 */

export const DEEP_LINK_CHANNEL = "link:deep-link";

/** The in-app path of a deep link, or null when the URL is not one of ours or the path is unsafe. */
export function parseDeepLink(url: unknown, scheme: string): string | null {
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${scheme}:` || parsed.host !== "open" || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    return null;
  }
  const path = parsed.searchParams.get("url");
  // Absolute in-app path only: no relative, no protocol-relative `//host`, no backslash tricks.
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  return path;
}

/** The first deep link in a command line (cold start or second instance on Windows/Linux). */
export function extractDeepLinkFromArgv(argv: readonly unknown[], scheme: string): string | null {
  for (const arg of argv) {
    const path = parseDeepLink(arg, scheme);
    if (path) return path;
  }
  return null;
}

const MAIN_RENDERER_MESSAGE_CHANNELS = [DEEP_LINK_CHANNEL] as const;

export type MainRendererMessageChannel = (typeof MAIN_RENDERER_MESSAGE_CHANNELS)[number];

type SendMessage = (channel: MainRendererMessageChannel, payload: unknown) => void;

/**
 * Holds renderer-bound messages until the renderer reports the channel ready
 * (`link:ready`). Pending messages survive a window close so a recreated
 * window still receives them.
 */
export class MainRendererQueue {
  private readonly readyChannels = new Set<MainRendererMessageChannel>();
  private readonly pending = new Map<MainRendererMessageChannel, unknown[]>();

  enqueue(channel: MainRendererMessageChannel, payload: unknown, send: SendMessage): void {
    if (this.readyChannels.has(channel)) {
      send(channel, payload);
      return;
    }
    const queued = this.pending.get(channel) ?? [];
    queued.push(payload);
    this.pending.set(channel, queued);
  }

  setReady(channel: MainRendererMessageChannel, ready: boolean, send: SendMessage): void {
    if (!ready) {
      this.readyChannels.delete(channel);
      return;
    }
    this.readyChannels.add(channel);
    const queued = this.pending.get(channel);
    if (!queued) return;
    this.pending.delete(channel);
    for (const payload of queued) send(channel, payload);
  }

  /** Clear readiness when the renderer document is replaced (reload), without losing work. */
  resetReady(): void {
    this.readyChannels.clear();
  }
}
