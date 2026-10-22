// Applying an urgent OTA sooner (audit "ota-apply-latency"). expo-updates
// checks once at launch and applies what it downloads at the next cold start,
// so a phone UniChat stays open on for days keeps a broken bundle for days.
// This controller checks again when UniChat comes back to the foreground (a
// minute after launch, then at most every 30 minutes) and downloads what it
// finds. An update marked critical — the OTA workflow's `critical` input,
// extra.criticalUpdate in the update's manifest (app.config.ts) — or a
// roll-back-to-embedded directive is applied once the app has stayed in the
// background for APPLY_AFTER_AWAY_MS (Android keeps JS running there), or, where
// the OS froze JS before that (iOS), on the return after APPLY_ON_RETURN_MS away,
// before the person has touched anything. Never on the trip to the background
// itself: Android goes there for the system screens the app opens (the sign-in
// Custom Tab, the pickers, a permission prompt), and a reload would drop their
// answer; never while one is up (data/system-ui.ts), mid-call or while one rings.
// Anything else waits for the next cold start, as before.
// Every outcome is a breadcrumb (scope "updates"), so a crash report says
// which update was fetched and when it was applied; a failed check is not an
// error (offline is normal).
import * as Updates from "expo-updates";
import { AppState } from "react-native";
import { callEngine } from "./calls/call-store";
import { createLogger } from "./logger";
import { systemUiOpen } from "./system-ui";

/** How long a foreground return waits after the last check before asking again. */
export const CHECK_INTERVAL_MS = 30 * 60_000;
/** The first check after launch: expo-updates' own launch check has finished by then. */
export const FIRST_CHECK_DELAY_MS = 60_000;
/** How long the app stays in the background before a critical update is applied there. */
export const APPLY_AFTER_AWAY_MS = 60_000;
/** An absence long enough that the return is as good as a cold start: a critical update the OS did not let us apply in the background is applied then. */
export const APPLY_ON_RETURN_MS = 10 * 60_000;

const log = createLogger("updates");

interface CheckResult {
  isAvailable: boolean;
  isRollBackToEmbedded?: boolean;
  manifest?: unknown;
}

interface FetchResult {
  isNew: boolean;
  isRollBackToEmbedded?: boolean;
  manifest?: unknown;
}

export interface UpdatesControllerDeps {
  /** expo-updates is on in this build (off in dev clients and Expo Go). */
  enabled: boolean;
  check: () => Promise<CheckResult>;
  fetch: () => Promise<FetchResult>;
  reload: () => Promise<void>;
  /** A call is ringing, connecting or on: a reload would cut it. */
  callActive: () => boolean;
  /** A system screen the app waits on is up (data/system-ui.ts): a reload would drop its answer. */
  systemUiOpen: () => boolean;
  /** The app is in the background now (a timer can fire late, on the way back). */
  inBackground: () => boolean;
  now: () => number;
}

export interface UpdatesController {
  /** The app came to the foreground (or the first check after launch is due). */
  onActive: () => Promise<void>;
  /** The app went to the background: a critical update is applied if it stays there. */
  onBackground: () => Promise<void>;
}

const field = (value: unknown, key: string): unknown => (value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined);

/** Whether an EAS Update manifest was published as critical: extra.expoClient.extra.criticalUpdate. */
export function isCriticalManifest(manifest: unknown): boolean {
  return field(field(field(field(manifest, "extra"), "expoClient"), "extra"), "criticalUpdate") === true;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 120);

export function createUpdatesController(deps: UpdatesControllerDeps): UpdatesController {
  // Launch counts as a check (expo-updates made it), shifted so the first of ours is due FIRST_CHECK_DELAY_MS in.
  let lastCheck = deps.now() - CHECK_INTERVAL_MS + FIRST_CHECK_DELAY_MS;
  let checking = false;
  let critical = false;
  let awayAt: number | null = null;
  let applyTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelApply = () => {
    if (applyTimer !== null) clearTimeout(applyTimer);
    applyTimer = null;
  };

  async function apply(): Promise<void> {
    if (deps.callActive()) {
      log.info("critical update waits for the call");
      return;
    }
    if (deps.systemUiOpen()) {
      log.info("critical update waits for the system screen");
      return;
    }
    critical = false;
    log.info("applying critical update");
    try {
      await deps.reload();
    } catch (error) {
      log.warn("critical update reload failed", { reason: reason(error) });
    }
  }

  return {
    async onActive() {
      cancelApply();
      const away = awayAt;
      awayAt = null;
      if (critical && away !== null && deps.now() - away >= APPLY_ON_RETURN_MS) {
        await apply();
        if (!critical) return;
      }
      if (!deps.enabled || checking || deps.now() - lastCheck < CHECK_INTERVAL_MS) return;
      checking = true;
      lastCheck = deps.now();
      try {
        const found = await deps.check();
        if (!found.isAvailable && !found.isRollBackToEmbedded) {
          log.info("no update");
          return;
        }
        const fetched = await deps.fetch();
        // Already downloaded at launch is not new, and is still the update this bundle is not running.
        critical = fetched.isRollBackToEmbedded === true || found.isRollBackToEmbedded === true || isCriticalManifest(fetched.manifest ?? found.manifest);
        log.info("update downloaded", { critical, isNew: fetched.isNew });
      } catch (error) {
        log.warn("update check failed", { reason: reason(error) });
      } finally {
        checking = false;
      }
    },
    async onBackground() {
      awayAt ??= deps.now();
      cancelApply();
      if (!critical) return;
      applyTimer = setTimeout(() => {
        applyTimer = null;
        // Fired late, on the way back (JS was frozen): onActive decides.
        if (deps.inBackground()) void apply();
      }, APPLY_AFTER_AWAY_MS);
    },
  };
}

declare const __DEV__: boolean | undefined;

/** The app's controller on expo-updates, AppState and the call engine; app/_layout.tsx starts it once. */
export function startUpdatesController(): () => void {
  const controller = createUpdatesController({
    enabled: Updates.isEnabled && !(typeof __DEV__ !== "undefined" && __DEV__),
    check: () => Updates.checkForUpdateAsync(),
    fetch: () => Updates.fetchUpdateAsync(),
    reload: () => Updates.reloadAsync(),
    callActive: () => {
      const { status } = callEngine.store.getState().call;
      return status !== "idle" && status !== "ended";
    },
    systemUiOpen,
    inBackground: () => AppState.currentState === "background",
    now: Date.now,
  });
  const first = setTimeout(() => {
    if (AppState.currentState === "active") void controller.onActive();
  }, FIRST_CHECK_DELAY_MS);
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") void controller.onActive();
    else if (state === "background") void controller.onBackground();
  });
  return () => {
    clearTimeout(first);
    subscription.remove();
  };
}
