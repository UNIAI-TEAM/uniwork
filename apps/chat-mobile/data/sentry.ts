// Crash reporting: @sentry/react-native, started only when the
// build carries a DSN (app.config.ts › extra.sentryDsn from SENTRY_DSN). A
// build without one runs exactly as before: no SDK call, no network, and
// data/report.ts stays a no-op. Every event leaves through lib/redact.ts:
// no email, token, URL query or chat text; the user is an opaque id. No
// screenshots, view hierarchy or session replay: a chat screen is private.
//
// Release and dist name the native build (`<appId>@<version>+<build>`, the
// build number), the tags the update that runs on it: an OTA crash is told
// apart by update_id and channel. Source maps carry Sentry debug ids
// (metro.config.js › getSentryExpoConfig), so an update's map matches without
// a release of its own (docs/runbooks/unichat-mobile-release.md).
import * as Sentry from "@sentry/react-native";
import { sentryRelease, type BuildInfo } from "@/lib/build-info";
import { scrubBreadcrumb, scrubEvent, scrubTransaction } from "@/lib/redact";
import { installReportSink } from "./report";

/** Screen loads and app start as spans; registered with expo-router's container in app/_layout.tsx. */
export const sentryNavigation = Sentry.reactNavigationIntegration({ enableTimeToInitialDisplay: true });

/**
 * Ends a screen load's "full display" once its data is drawn (`record`): the Chat tab with its rooms, a
 * conversation with its newest page. A no-op without a DSN, outside a screen load, and in a
 * build without Sentry's native view.
 */
export const ScreenFullyDrawn = Sentry.TimeToFullDisplay;

interface SentryStart {
  dsn: string | undefined;
  environment: "dev" | "staging" | "production";
  info: BuildInfo;
}

/** Starts the SDK and installs it as the report sink; false (and nothing started) without a DSN. */
export function initSentry({ dsn, environment, info }: SentryStart): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    release: sentryRelease(info),
    ...(info.build ? { dist: info.build } : {}),
    sendDefaultPii: false,
    // Crash-free sessions: the go/no-go bar (docs/evidence/unichat/go-no-go-template.md).
    enableAutoSessionTracking: true,
    attachScreenshot: false,
    attachViewHierarchy: false,
    // A tenth of production sessions trace app start and screen loads; every dev and staging one.
    tracesSampleRate: environment === "production" ? 0.1 : 1,
    // Half of those traced production sessions (5 % of all) carry a Hermes profile: a slow screen load, frozen
    // frame or JS stall then comes with the stack that spent the time. A profile holds function names and
    // timings, no chat content (audit perf-budgets-unmeasured).
    profilesSampleRate: environment === "production" ? 0.5 : 1,
    integrations: [sentryNavigation],
    // App start (cold and warm), slow and frozen frames and JS stalls ride on those spans (the SDK's defaults, said here).
    enableAppStartTracking: true,
    enableNativeFramesTracking: true,
    enableStallTracking: true,
    beforeSend: (event) => scrubEvent(event),
    // A span's description and data carry request URLs: the same scrub as an error's.
    beforeSendTransaction: (event) => scrubTransaction(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  Sentry.setTags({
    channel: info.channel || "none",
    update_id: info.updateId ?? "embedded",
    runtime_version: info.runtimeVersion || "unknown",
    os: info.os,
  });
  installReportSink({
    captureException: (error, context) => {
      Sentry.captureException(error, context);
    },
    addBreadcrumb: (breadcrumb) => Sentry.addBreadcrumb(breadcrumb),
    setUser: (id) => Sentry.setUser(id ? { id } : null),
    setTag: (key, value) => Sentry.setTag(key, value),
  });
  return true;
}
