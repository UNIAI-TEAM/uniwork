/**
 * Stable English slug bases for the "Random" button. The display name of each
 * comes from `onboarding.step_workspace.random_names.<slugBase>` in the
 * interface language (UNI-1484), so an English interface never suggests a
 * Vietnamese name; the slug stays the same in every language.
 */
export const CELESTIAL_SLUG_BASES = [
  "mercury",
  "venus",
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "luna",
  "polaris",
  "sirius",
  "vega",
  "altair",
  "andromeda",
  "orion",
  "galaxy",
] as const;

export type CelestialSlugBase = (typeof CELESTIAL_SLUG_BASES)[number];
