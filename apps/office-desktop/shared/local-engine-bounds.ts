/** A local working file is not size-capped by the desktop app. The engine
 * adapters default to the server contract bounds (64 MiB in, 128 MiB out);
 * every desktop host injects this instead. What a machine cannot hold surfaces
 * as the typed insufficient_memory answer, not as a size policy.
 *
 * Without a size cap a zip bomb is the remaining hazard, so every open also
 * pre-scans the package central directory (zipGuard) and refuses a package
 * whose declared size is out of proportion to its bytes. */
export const LOCAL_ENGINE_BOUNDS = {
  maxInputBytes: Number.POSITIVE_INFINITY,
  maxOutputBytes: Number.POSITIVE_INFINITY,
  zipGuard: "proportional",
} as const;
