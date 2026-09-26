import { paths } from "@uniwork/core/paths";

/** Public marketing sections: the landing and every page under these roots. */
const MARKETING_ROOTS = [
  paths.features(),
  paths.solutions.root(),
  paths.whyUniwork(),
  paths.learn(),
  paths.pricing(),
  paths.enterprise(),
];

/**
 * Pages that never read the session. The host skips the start-up refresh
 * there, so an anonymous visitor is not answered with a 401 on every load.
 */
export function isMarketingPath(pathname: string): boolean {
  if (pathname === paths.root()) return true;
  return MARKETING_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}
