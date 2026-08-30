/**
 * Endpoint configuration injected by the platform layer at boot.
 *
 * packages/core must not read `process.env`: it runs under Node in tests, and
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
  /** Matrix homeserver URL for matrix-js-sdk; empty when chat is disabled. */
  matrixHomeserverUrl: string;
}

const DEFAULTS: RuntimeConfig = {
  apiUrl: "http://localhost:8080",
  wsUrl: "ws://localhost:8080",
  appUrl: "http://localhost:3000",
  matrixHomeserverUrl: "",
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
