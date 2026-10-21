// Crash reporting (audit P0-2): @sentry/react-native, started only when the
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
import { scrubBreadcrumb, scrubEvent } from "@/lib/redact";
import { installReportSink } from "./report";

/** Screen loads and app start as spans; registered with expo-router's container in app/_layout.tsx. */
export const sentryNavigation = Sentry.reactNavigationIntegration({ enableTimeToInitialDisplay: true });

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
    integrations: [sentryNavigation],
    beforeSend: (event) => scrubEvent(event),
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
