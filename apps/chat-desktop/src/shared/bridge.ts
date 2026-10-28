// Type-only: core is compiled by the consuming app, and nothing here runs.
import type { DesktopLoginOptions } from "@uniwork/core/platform";

export type { DesktopBridge, DesktopLoginOptions, SessionProvider } from "@uniwork/core/platform";

/** The provider a sign-in may go straight to (`session:login`, spec §3.5). */
export type LoginProvider = DesktopLoginOptions["provider"];
