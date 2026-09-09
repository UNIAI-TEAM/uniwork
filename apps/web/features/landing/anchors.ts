/**
 * In-page anchors. Nav and footer point here whenever the equivalent route
 * does not exist yet: no new routes, and nothing that 404s
 * (docs/uniwork-landing-mapping.md §5). Slugs are unaccented Vietnamese, the
 * convention in docs/conventions.md.
 */
export const ANCHORS = {
  platform: "platform",
  solutions: "giai-phap",
  meetings: "hop",
  projects: "du-an",
  email: "email",
  workforce: "nhan-su-ai",
  contact: "lien-he",
} as const;

/**
 * Rooted at "/" rather than a bare fragment: the header and footer also render
 * on the solution pages, where "#platform" would point at a section that is not
 * in the document. On the home page the pathname already matches, so the
 * browser still treats this as a same-document scroll, not a reload.
 */
export const href = (anchor: (typeof ANCHORS)[keyof typeof ANCHORS]): string => `/#${anchor}`;
