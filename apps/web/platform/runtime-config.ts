import { configureRuntime } from "@uniwork/core/runtime-config";

/**
 * The only place in the app that reads the environment.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time by literal text
 * substitution, so these reads must stay written out in full here — a computed
 * key or a spread would be replaced with nothing. packages/core receives the
 * resolved values instead of reaching for them itself.
 *
 * Importing this module applies the configuration; it has no exports on
 * purpose so a caller cannot accidentally defer it past first use.
 */
configureRuntime({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});
