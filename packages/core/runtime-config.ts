/**
 * Endpoint configuration injected by the platform layer at boot.
 *
 * packages/core must not read environment variables: it runs under Node in tests, and
 * on any platform where no bundler inlines those values there is nothing to
 * read. The app that owns the environment sets them once at startup and every
 * core module reads them from here.
 *
 * The defaults match the previous inline fallbacks, so a consumer that never
 * calls `configureRuntime` (unit tests, a render harness) behaves exactly as
 * before.
 */
export interface RuntimeConfig {
  /** HTTP origin of the API server, no trailing slash. */
  apiUrl: string;
  /** WebSocket origin of the API server, no trailing slash. */
  wsUrl: string;
  /** Public origin of this app — the host shown in URL pills. */
  appUrl: string;
  /** Max concurrent chat:{roomId} WS subscriptions per client. */
  chatScopeSubscriptionLimit: number;
  /** `client_platform` the WebSocket handshake reports: "web", or "desktop" inside the UniChat shell. */
  clientPlatform: string;
  /**
   * Non-production opt-in that permits `window.__UNIWORK_FAKE_DRIVE_PICKER__`
   * to replace the real Google Picker in E2E / dev. Defaults to false and
   * stays false in production builds.
   */
  allowFakeDrivePicker: boolean;
}

const DEFAULTS: RuntimeConfig = {
  apiUrl: "http://localhost:8080",
  wsUrl: "ws://localhost:8080",
  appUrl: "http://localhost:3000",
  chatScopeSubscriptionLimit: 25,
  clientPlatform: "web",
  allowFakeDrivePicker: false,
};
let current: RuntimeConfig = { ...DEFAULTS };

/** Called once by the platform layer at boot. Later calls merge over earlier ones. */
export function configureRuntime(config: Partial<RuntimeConfig>): void {
  current = { ...current, ...config };
}

export function runtimeConfig(): Readonly<RuntimeConfig> {
  return current;
}

/** Test helper: restore defaults so one test cannot leak into the next. */
export function resetRuntimeConfig(): void {
  current = { ...DEFAULTS };
}
